package com.callquality.analyser.platform

import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.RowMapper
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

/** Size of one tenant, for capacity and support. Counts only: the operator never sees customer content. */
data class TenantOverview(
    val id: String,
    val name: String,
    val users: Int,
    val projects: Int,
    val tasks: Int,
    val approvedTasks: Int,
    val releases: Int,
)

/**
 * Platform operations, separate from tenant administration. An OPERATOR is not a member of any customer
 * organisation: every tenant-scoped endpoint (projects, tasks, recordings, admin pages) refuses them.
 */
@RestController
@RequestMapping("/api/platform")
@PreAuthorize("hasRole('OPERATOR')")
class PlatformController(private val jdbc: JdbcTemplate) {

    @GetMapping("/tenants")
    fun tenants(): List<TenantOverview> =
        jdbc.query(
            """
            SELECT t.id, t.name,
              (SELECT COUNT(*) FROM app_user u WHERE u.tenant_id = t.id) AS users,
              (SELECT COUNT(*) FROM project p WHERE p.tenant_id = t.id) AS projects,
              (SELECT COUNT(*) FROM task k JOIN project p ON p.id = k.project_id WHERE p.tenant_id = t.id) AS tasks,
              (SELECT COUNT(*) FROM task k JOIN project p ON p.id = k.project_id WHERE p.tenant_id = t.id AND k.status = 'APPROVED') AS approved,
              (SELECT COUNT(*) FROM dataset_release r JOIN project p ON p.id = r.project_id WHERE p.tenant_id = t.id) AS releases
            FROM tenant t ORDER BY t.name
            """.trimIndent(),
            RowMapper { rs, _ ->
                TenantOverview(
                    rs.getString("id"), rs.getString("name"), rs.getInt("users"), rs.getInt("projects"),
                    rs.getInt("tasks"), rs.getInt("approved"), rs.getInt("releases"),
                )
            },
        )
}
