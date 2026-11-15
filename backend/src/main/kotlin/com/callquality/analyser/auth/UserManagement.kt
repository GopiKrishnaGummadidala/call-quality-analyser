package com.callquality.analyser.auth

import com.fasterxml.jackson.databind.ObjectMapper
import com.callquality.analyser.common.ConflictException
import com.callquality.analyser.common.NotFoundException
import com.callquality.analyser.common.ValidationFailedException
import org.slf4j.LoggerFactory
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.RowMapper
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestAttribute
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.time.Clock
import java.time.OffsetDateTime
import java.time.temporal.ChronoUnit
import java.util.UUID

data class MembershipRequest(val projectId: String? = null, val role: Role? = null)

data class CreateUserRequest(
    val username: String? = null,
    val displayName: String? = null,
    val password: String? = null,
    val globalRole: GlobalRole? = null,
    val memberships: List<MembershipRequest>? = null,
)

/** The username never changes. A null password leaves it as it is; a new one replaces it. */
data class UpdateUserRequest(
    val displayName: String? = null,
    val password: String? = null,
    val globalRole: GlobalRole? = null,
    val memberships: List<MembershipRequest>? = null,
)

data class AccountEventView(
    val id: String,
    val actorName: String,
    val targetName: String,
    val action: String,
    val details: Map<String, Any?>,
    val createdAt: OffsetDateTime,
)

/**
 * Organisation admins create and change accounts of their own organisation only. Rules:
 * - account role is USER or ADMIN (the platform operator is not managed here);
 * - admins hold no project roles (they administer, they do not annotate or review);
 * - nobody removes their own admin role, so an organisation always keeps an admin;
 * - a new account role or password ends the user's existing sessions at once;
 * - every change is written to account_event, without the password.
 */
@Service
class UserManagementService(
    private val jdbc: JdbcTemplate,
    private val users: UserRepository,
    private val passwords: PasswordEncoder,
    private val mapper: ObjectMapper,
    private val clock: Clock,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    fun list(tenantId: String): List<AdminUserView> {
        val memberships = jdbc.query(
            """
            SELECT m.user_id, p.id, p.name, m.role FROM project_membership m
            JOIN project p ON p.id = m.project_id
            WHERE p.tenant_id = ? ORDER BY p.name
            """.trimIndent(),
            RowMapper { rs, _ -> rs.getString(1) to MembershipView(rs.getString(2), rs.getString(3), Role.valueOf(rs.getString(4))) },
            tenantId,
        ).groupBy({ it.first }, { it.second })
        val updated = jdbc.query(
            "SELECT id, updated_at FROM app_user WHERE tenant_id = ?",
            RowMapper { rs, _ -> rs.getString(1) to rs.getObject(2, OffsetDateTime::class.java) },
            tenantId,
        ).toMap()
        // Most recently created or changed first; ties (the seeded accounts) by name.
        return users.listByTenant(tenantId)
            .map { AdminUserView(it.id, it.username, it.displayName, it.globalRole, memberships[it.id].orEmpty(), updated[it.id]) }
            .sortedWith(compareByDescending<AdminUserView> { it.updatedAt }.thenBy { it.displayName })
    }

    @Transactional
    fun create(admin: CurrentUser, req: CreateUserRequest): AdminUserView {
        val username = req.username?.trim()?.lowercase().orEmpty()
        val displayName = req.displayName?.trim().orEmpty()
        val role = req.globalRole ?: GlobalRole.USER
        val memberships = req.memberships.orEmpty()
        val violations = mutableListOf<String>()
        if (!USERNAME.matches(username)) {
            violations += "Username must be 3 to 32 characters: lowercase letters, digits, dot, dash or underscore, starting with a letter or digit"
        }
        checkDisplayName(displayName, violations)
        checkPassword(req.password, required = true, violations)
        checkAccountRole(role, violations)
        checkMemberships(admin, role, memberships, violations)
        if (violations.isNotEmpty()) throw ValidationFailedException(violations)
        if (jdbc.queryForObject("SELECT COUNT(*) FROM app_user WHERE username = ?", Int::class.java, username)!! > 0) {
            throw ConflictException("USERNAME_TAKEN", "That username is already taken")
        }

        val id = "u-" + UUID.randomUUID().toString().substring(0, 8)
        jdbc.update(
            "INSERT INTO app_user (id, tenant_id, display_name, username, password_hash, global_role, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            id, admin.tenantId, displayName, username, passwords.encode(req.password!!), role.name, OffsetDateTime.now(clock),
        )
        replaceMemberships(id, memberships)
        record(admin, id, "USER_CREATED", mapOf(
            "username" to username, "displayName" to displayName, "globalRole" to role.name,
            "memberships" to memberships.map { mapOf("projectId" to it.projectId, "role" to it.role!!.name) },
        ))
        log.info("user created userId={} by adminId={}", id, admin.id)
        return view(admin.tenantId, id)
    }

    @Transactional
    fun update(admin: CurrentUser, userId: String, req: UpdateUserRequest): AdminUserView {
        val before = list(admin.tenantId).firstOrNull { it.id == userId } ?: throw NotFoundException("User not found")
        val displayName = req.displayName?.trim() ?: before.displayName
        val role = req.globalRole ?: before.globalRole
        val memberships = req.memberships
            ?: before.memberships.map { MembershipRequest(it.projectId, it.role) }
        val violations = mutableListOf<String>()
        checkDisplayName(displayName, violations)
        checkPassword(req.password, required = false, violations)
        checkAccountRole(role, violations)
        if (userId == admin.id && role != GlobalRole.ADMIN) violations += "You cannot remove your own admin role"
        checkMemberships(admin, role, memberships, violations)
        if (violations.isNotEmpty()) throw ValidationFailedException(violations)

        val changes = linkedMapOf<String, Any?>()
        if (displayName != before.displayName) changes["displayName"] = mapOf("from" to before.displayName, "to" to displayName)
        if (role != before.globalRole) changes["globalRole"] = mapOf("from" to before.globalRole.name, "to" to role.name)
        val oldRoles = before.memberships.associate { it.projectId to it.role.name }
        val newRoles = memberships.associate { it.projectId!! to it.role!!.name }
        if (oldRoles != newRoles) changes["memberships"] = mapOf("from" to oldRoles, "to" to newRoles)
        val passwordChanged = !req.password.isNullOrEmpty()

        jdbc.update("UPDATE app_user SET display_name = ?, global_role = ? WHERE id = ?", displayName, role.name, userId)
        if (oldRoles != newRoles) replaceMemberships(userId, memberships)
        if (passwordChanged) {
            jdbc.update("UPDATE app_user SET password_hash = ? WHERE id = ?", passwords.encode(req.password!!), userId)
        }
        if (passwordChanged || role != before.globalRole) {
            // Whole seconds, like the token's issued-at claim: tokens from before this second stop working.
            jdbc.update("UPDATE app_user SET sessions_valid_after = ? WHERE id = ?",
                OffsetDateTime.now(clock).truncatedTo(ChronoUnit.SECONDS), userId)
        }
        if (changes.isNotEmpty() || passwordChanged) {
            jdbc.update("UPDATE app_user SET updated_at = ? WHERE id = ?", OffsetDateTime.now(clock), userId)
        }
        if (changes.isNotEmpty()) record(admin, userId, "USER_UPDATED", changes)
        if (passwordChanged) record(admin, userId, "PASSWORD_RESET", emptyMap())
        log.info("user updated userId={} by adminId={} fields={} passwordReset={}", userId, admin.id, changes.keys, passwordChanged)
        return view(admin.tenantId, userId)
    }

    fun events(tenantId: String, limit: Int): List<AccountEventView> =
        jdbc.query(
            """
            SELECT e.id, a.display_name AS actor, t.display_name AS target, e.action, e.metadata_json, e.created_at
            FROM account_event e JOIN app_user a ON a.id = e.actor_id JOIN app_user t ON t.id = e.target_user_id
            WHERE e.tenant_id = ? ORDER BY e.seq DESC LIMIT ?
            """.trimIndent(),
            RowMapper { rs, _ ->
                @Suppress("UNCHECKED_CAST")
                AccountEventView(
                    rs.getString("id"), rs.getString("actor"), rs.getString("target"), rs.getString("action"),
                    mapper.readValue(rs.getString("metadata_json"), Map::class.java) as Map<String, Any?>,
                    rs.getObject("created_at", OffsetDateTime::class.java),
                )
            },
            tenantId, limit,
        )

    private fun view(tenantId: String, userId: String) = list(tenantId).first { it.id == userId }

    private fun checkDisplayName(name: String, violations: MutableList<String>) {
        if (name.isEmpty()) violations += "Full name is required"
        else if (name.length > 200) violations += "Full name must be at most 200 characters"
    }

    private fun checkPassword(password: String?, required: Boolean, violations: MutableList<String>) {
        if (password.isNullOrEmpty()) {
            if (required) violations += "Password is required"
            return
        }
        if (password.length < MIN_PASSWORD || password.length > 128 || !password.any { it.isLetter() } || !password.any { it.isDigit() }) {
            violations += "Password must be $MIN_PASSWORD to 128 characters with at least one letter and one digit"
        }
    }

    private fun checkAccountRole(role: GlobalRole, violations: MutableList<String>) {
        if (role == GlobalRole.OPERATOR) violations += "Account role must be user or admin"
    }

    private fun checkMemberships(admin: CurrentUser, role: GlobalRole, memberships: List<MembershipRequest>, violations: MutableList<String>) {
        if (memberships.any { it.projectId.isNullOrBlank() || it.role == null }) {
            violations += "Each project role needs a project and a role"
            return
        }
        if (role == GlobalRole.ADMIN && memberships.isNotEmpty()) {
            violations += "Admins administer the organisation and hold no project roles"
        }
        if (memberships.map { it.projectId }.toSet().size != memberships.size) violations += "A project can be listed only once"
        val own = jdbc.queryForList("SELECT id FROM project WHERE tenant_id = ?", String::class.java, admin.tenantId).toSet()
        // A project of another organisation is reported the same as one that does not exist.
        if (memberships.any { it.projectId !in own }) violations += "Unknown project"
    }

    private fun replaceMemberships(userId: String, memberships: List<MembershipRequest>) {
        jdbc.update("DELETE FROM project_membership WHERE user_id = ?", userId)
        memberships.forEach {
            jdbc.update("INSERT INTO project_membership (project_id, user_id, role) VALUES (?, ?, ?)", it.projectId, userId, it.role!!.name)
        }
    }

    private fun record(admin: CurrentUser, targetId: String, action: String, details: Map<String, Any?>) {
        jdbc.update(
            "INSERT INTO account_event (id, tenant_id, actor_id, target_user_id, action, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            UUID.randomUUID().toString(), admin.tenantId, admin.id, targetId, action, mapper.writeValueAsString(details), OffsetDateTime.now(clock),
        )
    }

    companion object {
        private val USERNAME = Regex("^[a-z0-9][a-z0-9._-]{2,31}$")

        /** Demo policy, long enough for the shared demo password; a production deployment would use SSO or a stronger rule. */
        const val MIN_PASSWORD = 7
    }
}

@RestController
@RequestMapping("/api/admin")
class UserManagementController(private val service: UserManagementService) {

    @PostMapping("/users")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasRole('ADMIN')")
    fun create(@RequestAttribute(AuthInterceptor.ATTR) admin: CurrentUser, @RequestBody body: CreateUserRequest): AdminUserView =
        service.create(admin, body)

    @PutMapping("/users/{userId}")
    @PreAuthorize("hasRole('ADMIN')")
    fun update(
        @RequestAttribute(AuthInterceptor.ATTR) admin: CurrentUser,
        @PathVariable("userId") userId: String,
        @RequestBody body: UpdateUserRequest,
    ): AdminUserView = service.update(admin, userId, body)

    @GetMapping("/account-events")
    @PreAuthorize("hasRole('ADMIN')")
    fun events(@RequestAttribute(AuthInterceptor.ATTR) admin: CurrentUser): List<AccountEventView> =
        service.events(admin.tenantId, 50)
}
