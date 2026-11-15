package com.callquality.analyser.datasets

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.callquality.analyser.audit.AuditRepository
import com.callquality.analyser.auth.CurrentUser
import com.callquality.analyser.common.NotFoundException
import com.callquality.analyser.common.ValidationFailedException
import com.callquality.analyser.tasks.TaskService
import org.springframework.core.io.ClassPathResource
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.RowMapper
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.security.MessageDigest
import java.time.Clock
import java.time.OffsetDateTime
import java.util.UUID

data class ProjectDataView(val id: String, val name: String, val approvedTasks: Int, val approvedAudioMs: Long, val releases: Int)

data class ReleaseView(
    val id: String,
    val projectId: String,
    val projectName: String,
    val version: Int,
    val createdAt: OffsetDateTime,
    val createdByName: String,
    val deidPolicy: String,
    val itemCount: Int,
    val audioMs: Long,
    val splits: Map<String, Int>,
    val redactions: Map<String, Int>,
    val manifestSha256: String,
    val downloads: Int,
)

data class ReleaseDetail(val release: ReleaseView, val preview: List<JsonNode>)

data class Manifest(val fileName: String, val sha256: String, val body: ByteArray)

/**
 * Training-data ETL: APPROVED annotations of one project -> a versioned, de-identified, immutable release.
 *
 * Extract  approved tasks + their current annotation (version recorded for lineage)
 * Transform  text de-identified ([Deidentifier]), stable train/val/test split by task id, recordings referenced by
 *            file name + SHA-256 (audio itself is NOT de-identified: it may only be used inside a contract-covered (DPA)
 *            training environment, which every record states)
 * Load     release + records written in one transaction, manifest hashed, release audited (DATASET_RELEASED);
 *          every manifest download is audited too (DATASET_EXPORTED)
 *
 * Only administrators of the project's organisation may release or export (enforced by the controller and by
 * the tenant check in [projectInTenant]).
 */
@Service
class DatasetService(
    private val jdbc: JdbcTemplate,
    private val mapper: ObjectMapper,
    private val audit: AuditRepository,
    private val clock: Clock,
) {
    fun projects(admin: CurrentUser): List<ProjectDataView> =
        jdbc.query(
            """
            SELECT p.id, p.name,
              (SELECT COUNT(*) FROM task t WHERE t.project_id = p.id AND t.status = 'APPROVED') AS approved,
              (SELECT COUNT(*) FROM dataset_release r WHERE r.project_id = p.id) AS releases
            FROM project p WHERE p.tenant_id = ? ORDER BY p.name
            """.trimIndent(),
            RowMapper { rs, _ ->
                val id = rs.getString("id")
                ProjectDataView(id, rs.getString("name"), rs.getInt("approved"), approvedAudioMs(id), rs.getInt("releases"))
            },
            admin.tenantId,
        )

    fun releases(admin: CurrentUser, projectId: String): List<ReleaseView> {
        projectInTenant(admin, projectId)
        return jdbc.query("$releaseSelect WHERE r.project_id = ? ORDER BY r.version DESC", releaseMapper, projectId)
    }

    fun detail(admin: CurrentUser, releaseId: String): ReleaseDetail {
        val release = findRelease(admin, releaseId)
        val preview = jdbc.query(
            "SELECT record_json FROM dataset_item WHERE release_id = ? ORDER BY ord LIMIT 3",
            RowMapper { rs, _ -> mapper.readTree(rs.getString(1)) }, releaseId,
        )
        return ReleaseDetail(release, preview)
    }

    @Transactional
    fun createRelease(admin: CurrentUser, projectId: String): ReleaseView {
        projectInTenant(admin, projectId)
        // Serialise releases per project so versions are gap-free (the unique constraint backs this up).
        jdbc.query("SELECT id FROM project WHERE id = ? FOR UPDATE", RowMapper { rs, _ -> rs.getString(1) }, projectId)
        val version = (jdbc.queryForObject("SELECT MAX(version) FROM dataset_release WHERE project_id = ?", Int::class.java, projectId) ?: 0) + 1

        // ---- extract
        val rows = jdbc.query(
            """
            SELECT t.id, t.task_type, t.input_json, a.payload_json, a.version
            FROM task t JOIN annotation a ON a.task_id = t.id
            WHERE t.project_id = ? AND t.status = 'APPROVED'
            ORDER BY t.id
            """.trimIndent(),
            RowMapper { rs, _ ->
                Extracted(rs.getString(1), rs.getString(2), mapper.readTree(rs.getString(3)), mapper.readTree(rs.getString(4)), rs.getLong(5))
            },
            projectId,
        )
        if (rows.isEmpty()) throw ValidationFailedException(listOf("There are no approved annotations to release yet"))

        // ---- transform
        val session = Deidentifier.Session()
        val records = rows.map { transform(it, session) }
        val lines = records.map { mapper.writeValueAsString(it.record) }
        val sha = sha256((lines.joinToString("\n") + "\n").toByteArray())
        val splits = records.groupingBy { it.split }.eachCount()

        // ---- load
        val releaseId = UUID.randomUUID().toString()
        val now = OffsetDateTime.now(clock)
        jdbc.update(
            """
            INSERT INTO dataset_release (id, project_id, version, created_by, created_at, deid_policy, item_count, audio_ms,
              split_train, split_val, split_test, redactions_json, manifest_sha256)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            releaseId, projectId, version, admin.id, now, Deidentifier.POLICY, records.size, records.sumOf { it.audioMs },
            splits["train"] ?: 0, splits["val"] ?: 0, splits["test"] ?: 0, mapper.writeValueAsString(session.counts()), sha,
        )
        records.forEachIndexed { i, r ->
            jdbc.update(
                "INSERT INTO dataset_item (release_id, ord, task_id, annotation_version, split, record_json) VALUES (?, ?, ?, ?, ?, ?)",
                releaseId, i, r.taskId, r.annotationVersion, r.split, lines[i],
            )
        }
        audit.insert(
            projectId, "DATASET", releaseId, admin.id, "DATASET_RELEASED",
            mapOf("version" to version, "items" to records.size, "policy" to Deidentifier.POLICY, "manifestSha256" to sha),
        )
        return findRelease(admin, releaseId)
    }

    /** The release's JSON Lines manifest, exactly as hashed at release time. Every download is audited. */
    @Transactional
    fun manifest(admin: CurrentUser, releaseId: String): Manifest {
        val release = findRelease(admin, releaseId)
        val lines = jdbc.queryForList("SELECT record_json FROM dataset_item WHERE release_id = ? ORDER BY ord", String::class.java, releaseId)
        val body = (lines.joinToString("\n") + "\n").toByteArray()
        check(sha256(body) == release.manifestSha256) { "manifest does not match its recorded hash" }
        audit.insert(release.projectId, "DATASET", releaseId, admin.id, "DATASET_EXPORTED", mapOf("version" to release.version, "manifestSha256" to release.manifestSha256))
        val slug = release.projectName.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-')
        return Manifest("$slug-v${release.version}.jsonl", release.manifestSha256, body)
    }

    // ---- transform ----------------------------------------------------------------------------------------------

    private data class Extracted(val taskId: String, val type: String, val input: JsonNode, val payload: JsonNode, val annotationVersion: Long)
    private data class Transformed(val taskId: String, val annotationVersion: Long, val split: String, val audioMs: Long, val record: Map<String, Any?>)

    private fun transform(row: Extracted, session: Deidentifier.Session): Transformed {
        val split = splitFor(row.taskId)
        val source = mapOf("task_id" to row.taskId, "annotation_version" to row.annotationVersion)
        return when (row.type) {
            "TRANSCRIPTION" -> {
                val file = row.input.path("audioUrl").asText().substringAfterLast('/')
                val durationMs = row.input.path("durationMs").asLong()
                val segments = row.payload.path("segments").map { s ->
                    linkedMapOf(
                        "start_ms" to s.path("startMs").asLong(), "end_ms" to s.path("endMs").asLong(),
                        "speaker" to s.path("speaker").asText(), "label" to s.path("label").asText(),
                        "text" to session.clean(s.path("text").asText()),
                    )
                }
                val record = linkedMapOf(
                    "type" to row.type, "split" to split, "source" to source,
                    "audio" to linkedMapOf(
                        "file" to file, "sha256" to audioSha(file), "duration_ms" to durationMs,
                        // Spoken names and account details are still in the audio: use only inside a DPA-covered environment.
                        "contains_identifiers" to true,
                    ),
                    "segments" to segments,
                )
                Transformed(row.taskId, row.annotationVersion, split, durationMs, record)
            }
            else -> {
                // CALL_SCORECARD: a labelled example for a call-quality model (transcript in, checks + outcome out).
                val record = linkedMapOf(
                    "type" to row.type, "split" to split, "source" to source,
                    "transcript" to row.input.path("transcript").map { line ->
                        mapOf("speaker" to line.path("speaker").asText(), "text" to session.clean(line.path("text").asText()))
                    },
                    "checks" to row.payload.path("checks").fields().asSequence()
                        .associate { (k, v) -> k to v.takeIf { it.isTextual }?.asText() },
                    "outcome" to row.payload.path("outcome").takeIf { it.isTextual }?.asText(),
                    "notes" to session.clean(row.payload.path("notes").asText("")),
                )
                Transformed(row.taskId, row.annotationVersion, split, 0, record)
            }
        }
    }

    /** Stable across releases (a task never moves between train and test, so no leakage between versions). */
    private fun splitFor(taskId: String): String = when (sha256(taskId.toByteArray()).take(2).toInt(16) % 10) {
        in 0..7 -> "train"
        8 -> "val"
        else -> "test"
    }

    private fun audioSha(file: String): String? {
        val clip = ClassPathResource("${TaskService.AUDIO_DIR}/$file")
        return if (clip.exists()) clip.inputStream.use { sha256(it.readAllBytes()) } else null
    }

    // ---- queries ------------------------------------------------------------------------------------------------

    private fun approvedAudioMs(projectId: String): Long =
        jdbc.queryForList("SELECT input_json FROM task WHERE project_id = ? AND status = 'APPROVED' AND task_type = 'TRANSCRIPTION'", String::class.java, projectId)
            .sumOf { mapper.readTree(it).path("durationMs").asLong() }

    private fun projectInTenant(admin: CurrentUser, projectId: String) {
        val found = jdbc.queryForObject("SELECT COUNT(*) FROM project WHERE id = ? AND tenant_id = ?", Int::class.java, projectId, admin.tenantId) ?: 0
        if (found == 0) throw NotFoundException("Not found")
    }

    private fun findRelease(admin: CurrentUser, releaseId: String): ReleaseView =
        jdbc.query("$releaseSelect WHERE r.id = ? AND p.tenant_id = ?", releaseMapper, releaseId, admin.tenantId).firstOrNull()
            ?: throw NotFoundException("Not found")

    private val releaseSelect = """
        SELECT r.*, p.name AS project_name, u.display_name AS created_by_name,
          (SELECT COUNT(*) FROM audit_event e WHERE e.entity_type = 'DATASET' AND e.entity_id = r.id AND e.action = 'DATASET_EXPORTED') AS downloads
        FROM dataset_release r JOIN project p ON p.id = r.project_id JOIN app_user u ON u.id = r.created_by
    """.trimIndent()

    private val releaseMapper = RowMapper { rs, _ ->
        @Suppress("UNCHECKED_CAST")
        ReleaseView(
            id = rs.getString("id"), projectId = rs.getString("project_id"), projectName = rs.getString("project_name"),
            version = rs.getInt("version"), createdAt = rs.getObject("created_at", OffsetDateTime::class.java),
            createdByName = rs.getString("created_by_name"), deidPolicy = rs.getString("deid_policy"),
            itemCount = rs.getInt("item_count"), audioMs = rs.getLong("audio_ms"),
            splits = linkedMapOf("train" to rs.getInt("split_train"), "val" to rs.getInt("split_val"), "test" to rs.getInt("split_test")),
            redactions = mapper.readValue(rs.getString("redactions_json"), Map::class.java) as Map<String, Int>,
            manifestSha256 = rs.getString("manifest_sha256"), downloads = rs.getInt("downloads"),
        )
    }

    private fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
}
