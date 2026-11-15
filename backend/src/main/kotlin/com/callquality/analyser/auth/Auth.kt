package com.callquality.analyser.auth

import com.callquality.analyser.common.ForbiddenException
import com.callquality.analyser.common.NotFoundException
import com.callquality.analyser.common.UnauthorizedException
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.context.annotation.Configuration
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.RowMapper
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken
import org.springframework.stereotype.Component
import org.springframework.stereotype.Repository
import org.springframework.stereotype.Service
import org.springframework.web.servlet.HandlerInterceptor
import org.springframework.web.servlet.config.annotation.InterceptorRegistry
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer

/** Per-project role (project_membership). */
enum class Role { ANNOTATOR, REVIEWER }

/**
 * Account-level role. ADMIN administers their own organisation (users, access log, training data). OPERATOR runs
 * the platform (tenant overview, demo reset), belongs to no customer organisation and sees no customer content.
 */
enum class GlobalRole { USER, ADMIN, OPERATOR }

data class CurrentUser(
    val id: String,
    val tenantId: String,
    val displayName: String,
    val username: String = "",
    val globalRole: GlobalRole = GlobalRole.USER,
    val tenantName: String = "",
    /** Tokens issued before this instant are no longer accepted (set when the account role or password changes). */
    val sessionsValidAfter: java.time.Instant? = null,
)

data class Credentials(val user: CurrentUser, val passwordHash: String)

@Repository
class UserRepository(private val jdbc: JdbcTemplate) {
    private val select = """
        SELECT u.id, u.tenant_id, u.display_name, u.username, u.global_role, u.password_hash, u.sessions_valid_after, t.name AS tenant_name
        FROM app_user u JOIN tenant t ON t.id = u.tenant_id
    """.trimIndent()

    private val mapper = RowMapper<CurrentUser> { rs, _ ->
        CurrentUser(
            id = rs.getString("id"),
            tenantId = rs.getString("tenant_id"),
            displayName = rs.getString("display_name"),
            username = rs.getString("username") ?: "",
            globalRole = GlobalRole.valueOf(rs.getString("global_role")),
            tenantName = rs.getString("tenant_name"),
            sessionsValidAfter = rs.getObject("sessions_valid_after", java.time.OffsetDateTime::class.java)?.toInstant(),
        )
    }

    fun find(id: String): CurrentUser? = jdbc.query("$select WHERE u.id = ?", mapper, id).firstOrNull()

    /** Only accounts with a password can sign in. */
    fun findCredentials(username: String): Credentials? =
        jdbc.query(
            "$select WHERE u.username = ? AND u.password_hash IS NOT NULL",
            RowMapper { rs, i -> Credentials(mapper.mapRow(rs, i)!!, rs.getString("password_hash")) },
            username,
        ).firstOrNull()

    fun listByTenant(tenantId: String): List<CurrentUser> =
        jdbc.query("$select WHERE u.tenant_id = ? ORDER BY u.display_name", mapper, tenantId)
}

/**
 * Bridges Spring Security to the rest of the app: the bearer token has already been verified by the
 * security filter chain; here the subject is resolved to a live [CurrentUser] (so deleted users lose
 * access immediately) and exposed as a request attribute. Downstream code only depends on [CurrentUser].
 */
@Component
class AuthInterceptor(private val users: UserRepository) : HandlerInterceptor {
    override fun preHandle(request: HttpServletRequest, response: HttpServletResponse, handler: Any): Boolean {
        if (request.method == "OPTIONS") return true
        val auth = SecurityContextHolder.getContext().authentication as? JwtAuthenticationToken
            ?: throw UnauthorizedException("Sign in required")
        val user = users.find(auth.token.subject) ?: throw UnauthorizedException("Unknown user")
        // An admin changed this account's role or password after the token was issued: the old session ends now.
        val issuedAt = auth.token.issuedAt
        if (user.sessionsValidAfter != null && (issuedAt == null || issuedAt.isBefore(user.sessionsValidAfter))) {
            throw UnauthorizedException("Your account was changed; please sign in again")
        }
        request.setAttribute(ATTR, user)
        return true
    }

    companion object {
        const val ATTR = "currentUser"
    }
}

@Configuration
class WebConfig(private val auth: AuthInterceptor) : WebMvcConfigurer {
    override fun addInterceptors(registry: InterceptorRegistry) {
        registry.addInterceptor(auth)
            .addPathPatterns("/api/**")
            .excludePathPatterns("/api/auth/login")
    }
}

/**
 * Authorization is always resolved on the server: user -> project membership (within the user's tenant) -> role.
 * Project/tenant ids supplied by the browser are never treated as proof of access, and project roles are not
 * carried in the token, so membership changes take effect on the next request.
 */
@Service
class AccessService(private val jdbc: JdbcTemplate) {
    fun roleInProject(user: CurrentUser, projectId: String): Role? =
        jdbc.query(
            """
            SELECT m.role FROM project_membership m
            JOIN project p ON p.id = m.project_id
            WHERE m.project_id = ? AND m.user_id = ? AND p.tenant_id = ?
            """.trimIndent(),
            RowMapper<Role> { rs, _ -> Role.valueOf(rs.getString(1)) },
            projectId, user.id, user.tenantId,
        ).firstOrNull()

    /** Non-members get 404 (not 403) so the existence of other projects/tasks is not revealed. */
    fun requireMember(user: CurrentUser, projectId: String): Role =
        roleInProject(user, projectId) ?: throw NotFoundException("Not found")

    fun requireRole(user: CurrentUser, projectId: String, required: Role): Role {
        val role = requireMember(user, projectId)
        if (role != required) throw ForbiddenException("This action requires the $required role")
        return role
    }
}
