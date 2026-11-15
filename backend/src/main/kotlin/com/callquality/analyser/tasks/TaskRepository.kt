package com.callquality.analyser.tasks

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.RowMapper
import org.springframework.stereotype.Repository
import java.time.OffsetDateTime
import java.util.UUID

@Repository
class TaskRepository(private val jdbc: JdbcTemplate, private val mapper: ObjectMapper) {

    private val taskMapper = RowMapper<TaskRecord> { rs, _ ->
        TaskRecord(
            id = rs.getString("id"),
            projectId = rs.getString("project_id"),
            taskType = rs.getString("task_type"),
            schemaVersion = rs.getInt("schema_version"),
            title = rs.getString("title"),
            input = mapper.readTree(rs.getString("input_json")),
            status = TaskStatus.valueOf(rs.getString("status")),
            assigneeId = rs.getString("assignee_id"),
            assigneeName = rs.getString("assignee_name"),
            version = rs.getLong("version"),
            createdAt = rs.getObject("created_at", OffsetDateTime::class.java),
            updatedAt = rs.getObject("updated_at", OffsetDateTime::class.java),
        )
    }

    private val annotationMapper = RowMapper<AnnotationRecord> { rs, _ ->
        AnnotationRecord(
            id = rs.getString("id"),
            taskId = rs.getString("task_id"),
            payload = mapper.readTree(rs.getString("payload_json")),
            version = rs.getLong("version"),
            updatedBy = rs.getString("updated_by"),
            updatedAt = rs.getObject("updated_at", OffsetDateTime::class.java),
        )
    }

    private val taskSelect =
        "SELECT t.*, u.display_name AS assignee_name FROM task t LEFT JOIN app_user u ON u.id = t.assignee_id"

    /**
     * One page of a project's tasks, most recently modified first (saving, submitting and reviewing all touch
     * updated_at), plus the number of tasks matching the filters.
     */
    fun page(projectId: String, status: TaskStatus?, type: String?, query: String?, offset: Int, limit: Int): Pair<List<TaskRecord>, Int> {
        val where = StringBuilder(" WHERE t.project_id = ?")
        val args = mutableListOf<Any>(projectId)
        if (status != null) {
            where.append(" AND t.status = ?")
            args.add(status.name)
        }
        if (type != null) {
            where.append(" AND t.task_type = ?")
            args.add(type)
        }
        if (!query.isNullOrBlank()) {
            where.append(" AND LOWER(t.title) LIKE ? ESCAPE '!'")
            val escaped = query.trim().lowercase().replace("!", "!!").replace("%", "!%").replace("_", "!_")
            args.add("%$escaped%")
        }
        val total = jdbc.queryForObject("SELECT COUNT(*) FROM task t$where", Int::class.java, *args.toTypedArray()) ?: 0
        val items = jdbc.query(
            "$taskSelect$where ORDER BY t.updated_at DESC, t.id LIMIT ? OFFSET ?",
            taskMapper, *(args + listOf(limit, offset)).toTypedArray(),
        )
        return items to total
    }

    /** Task count per status for the whole project (the queue's tabs and tiles). */
    fun statusCounts(projectId: String): Map<TaskStatus, Int> =
        jdbc.query(
            "SELECT status, COUNT(*) FROM task WHERE project_id = ? GROUP BY status",
            RowMapper { rs, _ -> TaskStatus.valueOf(rs.getString(1)) to rs.getInt(2) },
            projectId,
        ).toMap()

    fun taskTypes(projectId: String): List<String> =
        jdbc.queryForList("SELECT DISTINCT task_type FROM task WHERE project_id = ? ORDER BY task_type", String::class.java, projectId)

    fun find(id: String): TaskRecord? =
        jdbc.query("$taskSelect WHERE t.id = ?", taskMapper, id).firstOrNull()

    /**
     * Row lock on the task. Saves, submits and reviews all take this lock first, so they are serialized
     * per task; after acquiring it the caller re-reads the task to see the latest committed status.
     */
    fun lock(id: String) {
        jdbc.query("SELECT id FROM task WHERE id = ? FOR UPDATE", RowMapper<String> { rs, _ -> rs.getString(1) }, id)
    }

    /** Compare-and-set on status. Returns the number of rows changed (0 = someone else got there first). */
    fun updateStatus(id: String, from: TaskStatus, to: TaskStatus, now: OffsetDateTime): Int =
        jdbc.update(
            "UPDATE task SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND status = ?",
            to.name, now, id, from.name,
        )

    fun findAnnotation(taskId: String): AnnotationRecord? =
        jdbc.query("SELECT * FROM annotation WHERE task_id = ?", annotationMapper, taskId).firstOrNull()

    /** Optimistic concurrency: only succeeds when the stored version equals [expectedVersion]. */
    fun updateAnnotation(taskId: String, expectedVersion: Long, payload: JsonNode, userId: String, now: OffsetDateTime): Int =
        jdbc.update(
            """
            UPDATE annotation
            SET payload_json = ?, version = version + 1, updated_by = ?, updated_at = ?
            WHERE task_id = ? AND version = ?
            """.trimIndent(),
            mapper.writeValueAsString(payload), userId, now, taskId, expectedVersion,
        ).also { updated ->
            // An edit is a modification of the task too, so it moves to the top of the queue.
            if (updated == 1) jdbc.update("UPDATE task SET updated_at = ? WHERE id = ?", now, taskId)
        }

    fun insertReview(taskId: String, reviewerId: String, decision: ReviewDecision, comment: String?, now: OffsetDateTime): String {
        val id = UUID.randomUUID().toString()
        jdbc.update(
            "INSERT INTO review (id, task_id, reviewer_id, decision, comment_text, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            id, taskId, reviewerId, decision.name, comment, now,
        )
        return id
    }

    fun lastReview(taskId: String): ReviewView? =
        jdbc.query(
            """
            SELECT r.id, r.reviewer_id, u.display_name, r.decision, r.comment_text, r.created_at
            FROM review r JOIN app_user u ON u.id = r.reviewer_id
            WHERE r.task_id = ? ORDER BY r.created_at DESC, r.id DESC
            """.trimIndent(),
            RowMapper<ReviewView> { rs, _ ->
                ReviewView(
                    id = rs.getString(1),
                    reviewerId = rs.getString(2),
                    reviewerName = rs.getString(3),
                    decision = ReviewDecision.valueOf(rs.getString(4)),
                    comment = rs.getString(5),
                    createdAt = rs.getObject(6, OffsetDateTime::class.java),
                )
            },
            taskId,
        ).firstOrNull()
}
