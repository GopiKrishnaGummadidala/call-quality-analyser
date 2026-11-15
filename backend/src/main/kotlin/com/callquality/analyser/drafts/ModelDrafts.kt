package com.callquality.analyser.drafts

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.readValue
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.RowMapper
import org.springframework.stereotype.Repository
import java.time.OffsetDateTime

data class DraftSegment(val id: String, val text: String)

/** What the speech model wrote for a task, with where it came from. Never changed after it is stored. */
data class DraftView(
    val modelName: String,
    val modelVersion: String,
    val provenance: String,
    val segments: List<DraftSegment>,
)

@Repository
class DraftRepository(private val jdbc: JdbcTemplate, private val mapper: ObjectMapper) {

    fun insert(taskId: String, modelName: String, modelVersion: String, provenance: String, segments: List<DraftSegment>, at: OffsetDateTime) {
        jdbc.update(
            "INSERT INTO model_draft (task_id, model_name, model_version, provenance, segments_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            taskId, modelName, modelVersion, provenance, mapper.writeValueAsString(segments), at,
        )
    }

    fun find(taskId: String): DraftView? =
        jdbc.query(
            "SELECT model_name, model_version, provenance, segments_json FROM model_draft WHERE task_id = ?",
            RowMapper { rs, _ ->
                DraftView(rs.getString(1), rs.getString(2), rs.getString(3), mapper.readValue<List<DraftSegment>>(rs.getString(4)))
            },
            taskId,
        ).firstOrNull()
}
