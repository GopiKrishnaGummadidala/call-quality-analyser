package com.callquality.analyser.audit

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.callquality.analyser.auth.AccessService
import com.callquality.analyser.auth.AuthInterceptor
import com.callquality.analyser.auth.CurrentUser
import com.callquality.analyser.common.NotFoundException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.RowMapper
import org.springframework.stereotype.Repository
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestAttribute
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.time.Clock
import java.time.OffsetDateTime
import java.util.UUID

data class AuditEventView(
    val id: String,
    val action: String,
    val entityType: String,
    val entityId: String,
    val actorId: String,
    val actorName: String,
    val metadata: JsonNode,
    val createdAt: OffsetDateTime,
)

/**
 * insert() must be called inside the same @Transactional service method as the state change it records,
 * so that both commit or both roll back (docs/adr/0003-transactional-audit.md).
 */
@Repository
class AuditRepository(
    private val jdbc: JdbcTemplate,
    private val mapper: ObjectMapper,
    private val clock: Clock,
) {
    fun insert(
        projectId: String,
        entityType: String,
        entityId: String,
        actorId: String,
        action: String,
        metadata: Map<String, Any?>,
    ) {
        jdbc.update(
            """
            INSERT INTO audit_event (id, project_id, entity_type, entity_id, actor_id, action, metadata_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """.trimIndent(),
            UUID.randomUUID().toString(), projectId, entityType, entityId, actorId, action,
            mapper.writeValueAsString(metadata), OffsetDateTime.now(clock),
        )
    }

    fun listForEntity(entityType: String, entityId: String): List<AuditEventView> =
        jdbc.query(
            """
            SELECT e.id, e.action, e.entity_type, e.entity_id, e.actor_id, u.display_name, e.metadata_json, e.created_at
            FROM audit_event e JOIN app_user u ON u.id = e.actor_id
            WHERE e.entity_type = ? AND e.entity_id = ?
            ORDER BY e.seq
            """.trimIndent(),
            RowMapper<AuditEventView> { rs, _ ->
                AuditEventView(
                    id = rs.getString("id"),
                    action = rs.getString("action"),
                    entityType = rs.getString("entity_type"),
                    entityId = rs.getString("entity_id"),
                    actorId = rs.getString("actor_id"),
                    actorName = rs.getString("display_name"),
                    metadata = mapper.readTree(rs.getString("metadata_json")),
                    createdAt = rs.getObject("created_at", OffsetDateTime::class.java),
                )
            },
            entityType, entityId,
        )

    fun countForEntity(entityType: String, entityId: String): Int =
        jdbc.queryForObject(
            "SELECT COUNT(*) FROM audit_event WHERE entity_type = ? AND entity_id = ?",
            Int::class.java, entityType, entityId,
        ) ?: 0
}

@RestController
@RequestMapping("/api")
class AuditController(
    private val audit: AuditRepository,
    private val access: AccessService,
    private val jdbc: JdbcTemplate,
) {
    @GetMapping("/tasks/{taskId}/audit")
    fun history(
        @RequestAttribute(AuthInterceptor.ATTR) user: CurrentUser,
        @PathVariable("taskId") taskId: String,
    ): List<AuditEventView> {
        val projectId = jdbc.query(
            "SELECT project_id FROM task WHERE id = ?",
            RowMapper<String> { rs, _ -> rs.getString(1) },
            taskId,
        ).firstOrNull() ?: throw NotFoundException("Not found")
        access.requireMember(user, projectId)
        return audit.listForEntity("TASK", taskId)
    }
}
