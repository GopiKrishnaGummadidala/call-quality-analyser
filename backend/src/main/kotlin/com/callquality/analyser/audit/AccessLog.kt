package com.callquality.analyser.audit

import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.RowMapper
import org.springframework.stereotype.Repository
import java.time.Clock
import java.time.OffsetDateTime
import java.util.UUID

enum class AccessAction { VIEW_TASK, READ_AUDIO }
enum class AccessOutcome { ALLOWED, DENIED }

data class AccessLogView(
    val id: String,
    val taskId: String,
    val taskTitle: String,
    val projectName: String,
    /** The actor's name when they belong to the viewer's organisation; otherwise withheld. */
    val actorName: String,
    val actorUsername: String?,
    val sameOrganisation: Boolean,
    val action: AccessAction,
    val outcome: AccessOutcome,
    val createdAt: OffsetDateTime,
)

/**
 * Read-access log (who viewed a task or played its recording, and denied attempts).
 *
 * [record] runs in the caller's connection without a surrounding transaction, so an entry commits immediately and
 * also survives when the caller goes on to reject the request (denied attempts). Callers record BEFORE returning
 * data: if the insert fails, the read fails too ("no unlogged access").
 */
@Repository
class AccessLogRepository(private val jdbc: JdbcTemplate, private val clock: Clock) {

    fun record(projectId: String, taskId: String, userId: String, action: AccessAction, outcome: AccessOutcome) {
        jdbc.update(
            """
            INSERT INTO access_log (id, project_id, task_id, user_id, action, outcome, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            UUID.randomUUID().toString(), projectId, taskId, userId, action.name, outcome.name, OffsetDateTime.now(clock),
        )
    }

    /** Most recent entries for tasks owned by [tenantId]; actors from other organisations are not named. */
    fun recentForTenant(tenantId: String, limit: Int): List<AccessLogView> =
        jdbc.query(
            """
            SELECT l.id, l.task_id, t.title, p.name AS project_name, u.display_name, u.username, u.tenant_id AS actor_tenant,
                   l.action, l.outcome, l.created_at
            FROM access_log l
            JOIN project p ON p.id = l.project_id
            JOIN task t ON t.id = l.task_id
            JOIN app_user u ON u.id = l.user_id
            WHERE p.tenant_id = ?
            ORDER BY l.seq DESC
            LIMIT ?
            """.trimIndent(),
            RowMapper { rs, _ ->
                val same = rs.getString("actor_tenant") == tenantId
                AccessLogView(
                    id = rs.getString("id"),
                    taskId = rs.getString("task_id"),
                    taskTitle = rs.getString("title"),
                    projectName = rs.getString("project_name"),
                    actorName = if (same) rs.getString("display_name") else "User from another organisation",
                    actorUsername = if (same) rs.getString("username") else null,
                    sameOrganisation = same,
                    action = AccessAction.valueOf(rs.getString("action")),
                    outcome = AccessOutcome.valueOf(rs.getString("outcome")),
                    createdAt = rs.getObject("created_at", OffsetDateTime::class.java),
                )
            },
            tenantId, limit,
        )
}
