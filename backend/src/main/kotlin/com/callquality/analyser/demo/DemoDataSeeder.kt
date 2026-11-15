package com.callquality.analyser.demo

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.callquality.analyser.common.Pseudonymizer
import com.callquality.analyser.drafts.DraftRepository
import com.callquality.analyser.drafts.DraftSegment
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.ApplicationArguments
import org.springframework.boot.ApplicationRunner
import org.springframework.http.ResponseEntity
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.core.io.ClassPathResource
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.time.Clock
import java.time.OffsetDateTime
import java.util.UUID

/**
 * Seeds a fully synthetic demo dataset for a bank's call quality team: a small hand-written core (used by the
 * integration tests) plus recorded calls generated from data/calls.json (real synthesised speech with ground-truth
 * segment timings, see scripts/generate-audio.ps1) and QA scorecards for some of those calls, covering every task
 * status with matching reviews and audit history. Project creation, call upload, task claiming and ingestion are
 * deliberately out of scope. Names, amounts and account numbers are invented; text passes through the Pseudonymizer
 * on the way in to demonstrate the masking pipeline.
 */
@Component
class DemoDataSeeder(
    private val jdbc: JdbcTemplate,
    private val mapper: ObjectMapper,
    private val clock: Clock,
    private val passwords: PasswordEncoder,
    private val drafts: DraftRepository,
    @Value("\${app.seed.enabled:true}") private val enabled: Boolean,
    @Value("\${app.seed.demo-password}") private val demoPassword: String,
) : ApplicationRunner {

    /** Every demo account shares one password; hash it once (bcrypt is deliberately slow). */
    private val demoPasswordHash: String by lazy { passwords.encode(demoPassword)!! }

    private val pseudonymizer = Pseudonymizer(listOf("Anna Berger", "Max Keller", "Keller"))
    private val callManifest = "fixtures/calls/manifest.json"
    private val modelDrafts = "fixtures/model-drafts/drafts.json"

    override fun run(args: ApplicationArguments) {
        if (!enabled) return
        val empty = (jdbc.queryForObject("SELECT COUNT(*) FROM tenant", Int::class.java) ?: 0) == 0
        // Databases seeded by an older version (accounts without credentials, no platform operator): re-seed.
        val withoutCredentials = jdbc.queryForObject("SELECT COUNT(*) FROM app_user WHERE password_hash IS NULL", Int::class.java) ?: 0
        val operators = jdbc.queryForObject("SELECT COUNT(*) FROM app_user WHERE global_role = 'OPERATOR'", Int::class.java) ?: 0
        if (empty) seed() else if (withoutCredentials > 0 || operators == 0) reset()
    }

    @Transactional
    fun reset() {
        listOf("dataset_item", "dataset_release", "account_event", "access_log", "audit_event", "review", "model_draft", "annotation", "task", "model_run", "project_membership", "project", "app_user", "tenant")
            .forEach { jdbc.update("DELETE FROM $it") }
        seed()
    }

    private fun seed() {
        val now = OffsetDateTime.now(clock)
        jdbc.update("INSERT INTO tenant (id, name) VALUES (?, ?)", "tenant-1", "Northbridge Bank (demo)")
        jdbc.update("INSERT INTO tenant (id, name) VALUES (?, ?)", "tenant-2", "Other Bank")
        // The platform operator lives in its own tenant, outside every customer organisation.
        jdbc.update("INSERT INTO tenant (id, name) VALUES (?, ?)", "tenant-platform", "Platform operator")

        user("u-alice", "tenant-1", "Alice Becker", "alice")
        user("u-bob", "tenant-1", "Bob Novak", "bob")
        user("u-carol", "tenant-2", "Carol Diaz", "carol")
        user("u-dana", "tenant-1", "Dana Fischer", "admin", globalRole = "ADMIN")
        user("u-erik", "tenant-1", "Erik Hansen", "erik")
        user("u-ops", "tenant-platform", "Platform Ops", "ops", globalRole = "OPERATOR")

        jdbc.update("INSERT INTO project (id, tenant_id, name) VALUES (?, ?, ?)", "proj-a", "tenant-1", "Loan calls (demo)")
        jdbc.update("INSERT INTO project (id, tenant_id, name) VALUES (?, ?, ?)", "proj-b", "tenant-2", "Other bank project")
        member("proj-a", "u-alice", "ANNOTATOR")
        member("proj-a", "u-bob", "REVIEWER")
        member("proj-b", "u-carol", "ANNOTATOR")
        member("proj-a", "u-erik", "ANNOTATOR")
        // Roles are per project: Alice annotates in "Loan calls" but reviews in "Mortgage follow-ups".
        jdbc.update("INSERT INTO project (id, tenant_id, name) VALUES (?, ?, ?)", "proj-c", "tenant-1", "Mortgage follow-ups (demo)")
        member("proj-c", "u-erik", "ANNOTATOR")
        member("proj-c", "u-alice", "REVIEWER")

        // Recordings live in backend resources/audio and are served only through GET /api/tasks/{id}/audio.
        task(
            "t-audio-1", "proj-a", "TRANSCRIPTION", "Call 1: balance enquiry", "u-alice", now,
            input = mapOf("audioUrl" to "/audio/clip-1.wav", "durationMs" to 6000),
            payload = mapOf(
                "segments" to listOf(
                    segment("s1", 0, 3000, "AGENT", "CLEAR", "Customer Anna Berger asks for the balance of her savings account."),
                    segment("s2", 3000, 6000, "CUSTOMER", "UNCLEAR", ""),
                ),
            ),
        )
        task(
            "t-audio-2", "proj-a", "TRANSCRIPTION", "Call 2: overlapping speech", "u-alice", now,
            input = mapOf("audioUrl" to "/audio/clip-2.wav", "durationMs" to 6000),
            payload = mapOf(
                "segments" to listOf(
                    segment("s1", 0, 3500, "AGENT", "CLEAR", "Please call Max Keller back on +49 30 1234567 after lunch."),
                    segment("s2", 2500, 5000, "CUSTOMER", "CROSSTALK", ""),
                ),
            ),
        )
        task(
            "t-score-1", "proj-a", "CALL_SCORECARD", "QA: short service call", "u-alice", now,
            input = scorecardInput("Short service call", listOf(
                "AGENT" to "Thank you for calling, can I take your full name and date of birth first?",
                "CUSTOMER" to "I only want to know when my card will arrive.",
                "AGENT" to "It was posted yesterday and should arrive within three working days.",
            )),
            payload = emptyScorecard(),
        )
        task(
            "t-b-1", "proj-b", "CALL_SCORECARD", "Other tenant task", "u-carol", now,
            input = scorecardInput("Other bank call", listOf("AGENT" to "Your overdraft limit has been increased.")),
            payload = emptyScorecard(),
        )

        modelRun("run-a", "proj-a", "Sample model A (baseline)", "v1", "fixtures/model-outputs/sample-model-a-v1.json")
        modelRun("run-b", "proj-a", "Sample model B (candidate)", "v2", "fixtures/model-outputs/sample-model-b-v2.json")

        seedRealistic(now)
    }

    /** Tasks from the generated manifest, each with a believable history (saves, submit, review) a few hours old. */
    private fun seedRealistic(now: OffsetDateTime) {
        val resource = ClassPathResource(callManifest)
        if (!resource.exists()) return
        val manifest = resource.inputStream.use { mapper.readTree(it) }
        // Real first drafts from a speech model (scripts/draft_with_whisper.py); pseudonymised on ingest like all text.
        val draftsFile = ClassPathResource(modelDrafts).takeIf { it.exists() }?.inputStream?.use { mapper.readTree(it) }
        val draftModel = draftsFile?.path("model")
        fun draftText(clipId: String, segmentId: String): String? =
            draftsFile?.path("drafts")?.path(clipId)?.path("segments")?.firstOrNull { it.path("id").asText() == segmentId }
                ?.path("text")?.asText()?.let { pseudonymizer.mask(it) }
        manifest["calls"].forEachIndexed { i, d ->
            val prefill = d["prefill"].asText()
            val mistake = d.path("speakerMistake").takeIf { it.isInt }?.asInt()
            val segments = if (prefill == "none") emptyList() else d["segments"].mapIndexed { si, sg ->
                val text = when (prefill) {
                    "complete" -> sg["text"].asText()
                    "draft" -> if (si == 0) sg["text"].asText() else ""
                    // model-assisted: the speech model wrote a first draft, the annotator listens and corrects it
                    "model" -> draftText(d["clipId"].asText(), sg["id"].asText()) ?: ""
                    else -> "" // "boundaries": pre-segmented (e.g. by voice activity detection), text still to transcribe
                }
                // speakerMistake: the annotator picked the wrong speaker for this segment (what the reviewer flagged)
                val speaker = if (si == mistake) "AGENT" else sg["speaker"].asText()
                segment(sg["id"].asText(), sg["startMs"].asInt(), sg["endMs"].asInt(), speaker, sg["label"].asText(), text)
            }
            lifecycle(
                id = "t-${d["clipId"].asText()}", project = d["project"].asText(), type = "TRANSCRIPTION",
                title = d["title"].asText(), assignee = d["assignee"].asText(), status = d["status"].asText(),
                review = d.path("review"), startedAt = now.minusHours(26L - i * 2L), edited = prefill == "draft" || prefill == "complete",
                input = mapOf("audioUrl" to d["audioUrl"].asText(), "durationMs" to d["durationMs"].asInt()),
                payload = mapOf("segments" to segments),
            )
            // The model drafted every recording in the pipeline; keep its draft next to the human annotation.
            if (draftModel != null) {
                val clipId = d["clipId"].asText()
                drafts.insert(
                    "t-$clipId", draftModel.path("name").asText(), draftModel.path("version").asText(),
                    draftModel.path("provenance").asText(),
                    d["segments"].map { sg -> DraftSegment(sg["id"].asText(), draftText(clipId, sg["id"].asText()) ?: "") },
                    now.minusHours(27L - i * 2L),
                )
            }
        }
        // QA scorecards: a reviewer of conduct scores a call the team has already transcribed.
        val callsById = manifest["calls"].associateBy { it["clipId"].asText() }
        manifest["scorecards"].forEachIndexed { i, sc ->
            val call = callsById.getValue(sc["call"].asText())
            val checks = sc.path("checks")
            lifecycle(
                id = "t-${sc["id"].asText()}", project = sc["project"].asText(), type = "CALL_SCORECARD",
                title = sc["title"].asText(), assignee = sc["assignee"].asText(), status = sc["status"].asText(),
                review = sc.path("review"), startedAt = now.minusHours(20L - i * 3L), edited = checks.isObject,
                input = scorecardInput(call["title"].asText(), call["segments"].map { it["speaker"].asText() to it["text"].asText() }),
                payload = mapOf(
                    "checks" to SCORECARD_CHECKS.associateWith { checks.path(it).takeIf { n -> n.isTextual }?.asText() },
                    "outcome" to sc.path("outcome").takeIf { it.isTextual }?.asText(),
                    "notes" to sc.path("notes").asText(""),
                ),
            )
        }
    }

    /** What a scorecard task shows: the call it scores, as a speaker-labelled transcript (pseudonymised). */
    private fun scorecardInput(callTitle: String, lines: List<Pair<String, String>>) = mapOf(
        "callTitle" to callTitle,
        "transcript" to lines.map { (speaker, text) -> mapOf("speaker" to speaker, "text" to pseudonymizer.mask(text)) },
    )

    private fun emptyScorecard() = mapOf("checks" to SCORECARD_CHECKS.associateWith { null }, "outcome" to null, "notes" to "")

    /**
     * Inserts a task in [status] together with what the real lifecycle would have written to get there
     * (annotation versions, SUBMITTED / review audit events with the same metadata shape, review rows).
     */
    private fun lifecycle(
        id: String, project: String, type: String, title: String, assignee: String, status: String, review: JsonNode,
        startedAt: OffsetDateTime, edited: Boolean, input: Map<String, Any?>, payload: Map<String, Any?>,
    ) {
        val submitted = status != "IN_PROGRESS"
        val reviewed = status == "APPROVED" || status == "CHANGES_REQUESTED"
        val submittedAt = startedAt.plusMinutes(42)
        val reviewedAt = submittedAt.plusMinutes(95)
        val annotationVersion = if (submitted) 3L else if (edited) 1L else 0L
        val updatedAt = if (reviewed) reviewedAt else if (submitted) submittedAt else if (edited) startedAt.plusMinutes(18) else startedAt
        val taskVersion = (if (submitted) 1L else 0L) + (if (reviewed) 1L else 0L)
        insertTask(
            id, project, type, title, input, payload, status, assignee, taskVersion, startedAt, updatedAt,
            annotationVersion, if (annotationVersion > 0) assignee else null,
        )
        if (submitted) {
            auditEvent(project, id, assignee, "TASK_SUBMITTED", submittedAt,
                mapOf("fromStatus" to "IN_PROGRESS", "toStatus" to "SUBMITTED", "annotationVersion" to annotationVersion))
        }
        if (reviewed) {
            val reviewer = review["reviewer"].asText()
            val approve = status == "APPROVED"
            val reviewId = UUID.randomUUID().toString()
            val comment = review.path("comment").asText("").ifBlank { null }
            jdbc.update(
                "INSERT INTO review (id, task_id, reviewer_id, decision, comment_text, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                reviewId, id, reviewer, if (approve) "APPROVE" else "REQUEST_CHANGES", comment, reviewedAt,
            )
            auditEvent(project, id, reviewer, if (approve) "TASK_APPROVED" else "TASK_CHANGES_REQUESTED", reviewedAt,
                mapOf("fromStatus" to "SUBMITTED", "toStatus" to status, "reviewId" to reviewId))
        }
    }

    private fun auditEvent(project: String, taskId: String, actor: String, action: String, at: OffsetDateTime, metadata: Map<String, Any?>) =
        jdbc.update(
            """
            INSERT INTO audit_event (id, project_id, entity_type, entity_id, actor_id, action, metadata_json, created_at)
            VALUES (?, ?, 'TASK', ?, ?, ?, ?, ?)
            """.trimIndent(),
            UUID.randomUUID().toString(), project, taskId, actor, action, mapper.writeValueAsString(metadata), at,
        )

    private fun segment(id: String, start: Int, end: Int, speaker: String, label: String, rawText: String) =
        mapOf("id" to id, "startMs" to start, "endMs" to end, "speaker" to speaker, "label" to label, "text" to pseudonymizer.mask(rawText))

    private companion object {
        val SCORECARD_CHECKS = com.callquality.analyser.annotations.CallScorecardTaskType.CHECKS
    }

    private fun user(id: String, tenant: String, name: String, username: String, globalRole: String = "USER") =
        jdbc.update(
            "INSERT INTO app_user (id, tenant_id, display_name, username, password_hash, global_role) VALUES (?, ?, ?, ?, ?, ?)",
            id, tenant, name, username, demoPasswordHash, globalRole,
        )

    private fun member(project: String, user: String, role: String) =
        jdbc.update("INSERT INTO project_membership (project_id, user_id, role) VALUES (?, ?, ?)", project, user, role)

    private fun modelRun(id: String, project: String, name: String, version: String, key: String) =
        jdbc.update(
            "INSERT INTO model_run (id, project_id, task_type, model_name, model_version, output_fixture_key) VALUES (?, ?, 'TRANSCRIPTION', ?, ?, ?)",
            id, project, name, version, key,
        )

    private fun task(
        id: String, project: String, type: String, title: String, assignee: String, now: OffsetDateTime,
        input: Map<String, Any?>, payload: Map<String, Any?>,
    ) = insertTask(id, project, type, title, input, payload, "IN_PROGRESS", assignee, 0, now, now, 0, null)

    private fun insertTask(
        id: String, project: String, type: String, title: String, input: Map<String, Any?>, payload: Map<String, Any?>,
        status: String, assignee: String, version: Long, createdAt: OffsetDateTime, updatedAt: OffsetDateTime,
        annotationVersion: Long, updatedBy: String?,
    ) {
        jdbc.update(
            """
            INSERT INTO task (id, project_id, task_type, schema_version, title, input_json, status, assignee_id, version, created_at, updated_at)
            VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            id, project, type, title, mapper.writeValueAsString(input), status, assignee, version, createdAt, updatedAt,
        )
        jdbc.update(
            "INSERT INTO annotation (id, task_id, payload_json, version, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            "ann-$id", id, mapper.writeValueAsString(payload), annotationVersion, updatedBy, updatedAt,
        )
    }
}

/**
 * Demo maintenance. The reset re-seeds EVERY tenant, so it belongs to the platform operator, never to a tenant
 * admin (who must not affect other organisations). Disable entirely with app.demo-endpoints.enabled=false.
 */
@RestController
@RequestMapping("/api/demo")
@ConditionalOnProperty(name = ["app.demo-endpoints.enabled"], havingValue = "true", matchIfMissing = true)
class DemoController(private val seeder: DemoDataSeeder) {
    @PostMapping("/reset")
    @PreAuthorize("hasRole('OPERATOR')")
    fun reset(): ResponseEntity<Void> {
        seeder.reset()
        return ResponseEntity.noContent().build()
    }
}
