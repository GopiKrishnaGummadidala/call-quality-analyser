package com.callquality.analyser.evaluation

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.callquality.analyser.auth.AccessService
import com.callquality.analyser.auth.AuthInterceptor
import com.callquality.analyser.auth.CurrentUser
import org.springframework.core.io.ClassPathResource
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.RowMapper
import org.springframework.stereotype.Service
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestAttribute
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

data class ClipResult(
    val clipId: String,
    val reference: String,
    val hypothesis: String,
    val substitutions: Int,
    val deletions: Int,
    val insertions: Int,
    val referenceWords: Int,
    val wer: Double,
)

data class ModelResult(
    val modelName: String,
    val modelVersion: String,
    val provenance: String,
    val substitutions: Int,
    val deletions: Int,
    val insertions: Int,
    val referenceWords: Int,
    val wer: Double,
    val clips: List<ClipResult>,
)

data class EvaluationReport(
    val projectId: String,
    val metric: String,
    val metricDefinition: String,
    val datasetName: String,
    val datasetSize: Int,
    val totalReferenceWords: Int,
    val disclaimer: String,
    val models: List<ModelResult>,
    /** Real model drafts vs the transcripts reviewers approved (model-assisted annotation). */
    val draftCorrections: DraftCorrectionReport? = null,
)

data class DraftTaskCorrection(
    val taskId: String,
    val title: String,
    val segments: Int,
    val segmentsEdited: Int,
    val referenceWords: Int,
    val wer: Double,
)

/**
 * How much annotators had to correct the speech model's drafts, measured on APPROVED tasks only (a reviewer
 * confirmed the final text, so it is the reference). WER here is the share of words humans changed.
 */
data class DraftCorrectionReport(
    val modelName: String,
    val modelVersion: String,
    val provenance: String,
    val approvedTasks: Int,
    val segments: Int,
    val segmentsUnchanged: Int,
    val substitutions: Int,
    val deletions: Int,
    val insertions: Int,
    val referenceWords: Int,
    val wer: Double,
    val tasks: List<DraftTaskCorrection>,
)

private data class ModelRunRow(val name: String, val version: String, val fixtureKey: String)

/** Deterministic: everything is computed from committed fixtures. Nothing is invented or simulated. */
@Service
class EvaluationService(
    private val jdbc: JdbcTemplate,
    private val access: AccessService,
    private val mapper: ObjectMapper,
) {
    fun report(user: CurrentUser, projectId: String): EvaluationReport {
        access.requireMember(user, projectId)
        val reference = loadJson("fixtures/transcripts/reference.json")
        val references = reference.path("clips").associate { it.path("clipId").asText() to it.path("reference").asText() }

        val runs = jdbc.query(
            """
            SELECT model_name, model_version, output_fixture_key FROM model_run
            WHERE project_id = ? AND task_type = 'TRANSCRIPTION' ORDER BY model_name, model_version
            """.trimIndent(),
            RowMapper<ModelRunRow> { rs, _ -> ModelRunRow(rs.getString(1), rs.getString(2), rs.getString(3)) },
            projectId,
        )

        val models = runs.map { run ->
            val output = loadJson(run.fixtureKey)
            val clips = output.path("outputs").map { o ->
                val clipId = o.path("clipId").asText()
                val ref = references.getValue(clipId)
                val hyp = o.path("hypothesis").asText()
                val r = WerCalculator.compute(ref, hyp)
                ClipResult(clipId, ref, hyp, r.substitutions, r.deletions, r.insertions, r.referenceWords, r.wer)
            }
            val s = clips.sumOf { it.substitutions }
            val d = clips.sumOf { it.deletions }
            val i = clips.sumOf { it.insertions }
            val n = clips.sumOf { it.referenceWords }
            ModelResult(run.name, run.version, output.path("provenance").asText(), s, d, i, n, (s + d + i).toDouble() / n, clips)
        }

        return EvaluationReport(
            projectId = projectId,
            metric = "WER",
            metricDefinition = "WER = (substitutions + deletions + insertions) / reference words, aggregated over all clips " +
                "(corpus-level, not a mean of per-clip rates). Text is lower-cased and punctuation is removed before comparison.",
            datasetName = reference.path("datasetName").asText(),
            datasetSize = references.size,
            totalReferenceWords = models.firstOrNull()?.referenceWords ?: 0,
            disclaimer = "Illustrative only: a handful of short clips is not a representative benchmark, " +
                "and no model-improvement claim should be drawn from it.",
            models = models,
            draftCorrections = draftCorrections(projectId),
        )
    }

    private fun draftCorrections(projectId: String): DraftCorrectionReport? {
        data class Row(val id: String, val title: String, val model: String, val version: String, val provenance: String,
                       val approved: JsonNode, val draft: JsonNode)
        val drafted = jdbc.queryForObject(
            "SELECT COUNT(*) FROM model_draft d JOIN task t ON t.id = d.task_id WHERE t.project_id = ?", Int::class.java, projectId,
        ) ?: 0
        if (drafted == 0) return null
        val rows = jdbc.query(
            """
            SELECT t.id, t.title, d.model_name, d.model_version, d.provenance, a.payload_json, d.segments_json
            FROM model_draft d JOIN task t ON t.id = d.task_id JOIN annotation a ON a.task_id = t.id
            WHERE t.project_id = ? AND t.status = 'APPROVED' ORDER BY t.id
            """.trimIndent(),
            RowMapper { rs, _ ->
                Row(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                    mapper.readTree(rs.getString(6)), mapper.readTree(rs.getString(7)))
            },
            projectId,
        )
        val model = jdbc.queryForList(
            "SELECT d.model_name, d.model_version, d.provenance FROM model_draft d JOIN task t ON t.id = d.task_id WHERE t.project_id = ?",
            projectId,
        ).first()
        var s = 0; var d = 0; var i = 0; var n = 0; var segs = 0; var unchanged = 0
        val tasks = rows.map { row ->
            val draftById = row.draft.associate { it.path("id").asText() to it.path("text").asText() }
            val final = row.approved.path("segments").toList()
            val edited = final.count { seg -> draftById[seg.path("id").asText()]?.trim() != seg.path("text").asText().trim() }
            val r = WerCalculator.compute(
                final.joinToString(" ") { it.path("text").asText() },
                row.draft.joinToString(" ") { it.path("text").asText() },
            )
            s += r.substitutions; d += r.deletions; i += r.insertions; n += r.referenceWords
            segs += final.size; unchanged += final.size - edited
            DraftTaskCorrection(row.id, row.title, final.size, edited, r.referenceWords, r.wer)
        }
        return DraftCorrectionReport(
            modelName = model["model_name"] as String, modelVersion = model["model_version"] as String,
            provenance = model["provenance"] as String, approvedTasks = rows.size, segments = segs,
            segmentsUnchanged = unchanged, substitutions = s, deletions = d, insertions = i, referenceWords = n,
            wer = if (n == 0) 0.0 else (s + d + i).toDouble() / n, tasks = tasks,
        )
    }

    private fun loadJson(path: String): JsonNode = ClassPathResource(path).inputStream.use { mapper.readTree(it) }
}

@RestController
@RequestMapping("/api")
class EvaluationController(private val service: EvaluationService) {
    @GetMapping("/projects/{projectId}/evaluation")
    fun report(
        @RequestAttribute(AuthInterceptor.ATTR) user: CurrentUser,
        @PathVariable("projectId") projectId: String,
    ): EvaluationReport = service.report(user, projectId)
}
