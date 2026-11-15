package com.callquality.analyser.auth

import com.fasterxml.jackson.databind.ObjectMapper
import com.nimbusds.jose.jwk.source.ImmutableSecret
import com.nimbusds.jose.proc.SecurityContext
import com.callquality.analyser.audit.AccessLogRepository
import com.callquality.analyser.audit.AccessLogView
import com.callquality.analyser.common.ApiError
import com.callquality.analyser.common.UnauthorizedException
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.RowMapper
import org.springframework.security.access.AccessDeniedException
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.core.AuthenticationException
import org.springframework.security.crypto.factory.PasswordEncoderFactories
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.security.oauth2.jose.jws.MacAlgorithm
import org.springframework.security.oauth2.jwt.JwsHeader
import org.springframework.security.oauth2.jwt.JwtClaimsSet
import org.springframework.security.oauth2.jwt.JwtDecoder
import org.springframework.security.oauth2.jwt.JwtEncoder
import org.springframework.security.oauth2.jwt.JwtEncoderParameters
import org.springframework.security.oauth2.jwt.JwtValidators
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter
import org.springframework.security.web.AuthenticationEntryPoint
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.access.AccessDeniedHandler
import org.springframework.stereotype.Component
import org.springframework.stereotype.Service
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestAttribute
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.time.Clock
import java.time.Duration
import java.time.Instant
import javax.crypto.SecretKey
import javax.crypto.spec.SecretKeySpec

private const val ISSUER = "call-quality-analyser"

/**
 * Stateless bearer-token security. Tokens are HS256 JWTs issued by [AuthController.login]; the account role
 * travels in the `roles` claim (-> ROLE_USER / ROLE_ADMIN). CSRF protection is off because no cookies are
 * used: the token is only ever sent in the Authorization header.
 */
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
class SecurityConfig {

    @Bean
    fun securityFilterChain(http: HttpSecurity, entryPoint: JsonAuthEntryPoint, denied: JsonAccessDeniedHandler): SecurityFilterChain {
        val authorities = JwtGrantedAuthoritiesConverter().apply {
            setAuthoritiesClaimName("roles")
            setAuthorityPrefix("ROLE_")
        }
        val converter = JwtAuthenticationConverter().apply { setJwtGrantedAuthoritiesConverter(authorities) }
        http
            .csrf { it.disable() }
            .httpBasic { it.disable() }
            .formLogin { it.disable() }
            .logout { it.disable() }
            .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
            .authorizeHttpRequests {
                it.requestMatchers(HttpMethod.POST, "/api/auth/login").permitAll()
                    .requestMatchers("/api/**").authenticated()
                    .anyRequest().permitAll()
            }
            .oauth2ResourceServer { rs ->
                rs.jwt { it.jwtAuthenticationConverter(converter) }
                rs.authenticationEntryPoint(entryPoint)
                rs.accessDeniedHandler(denied)
            }
            .exceptionHandling {
                it.authenticationEntryPoint(entryPoint)
                it.accessDeniedHandler(denied)
            }
        return http.build()
    }

    @Bean
    fun jwtSigningKey(@Value("\${app.auth.jwt-secret}") secret: String): SecretKey {
        val bytes = secret.toByteArray(Charsets.UTF_8)
        require(bytes.size >= 32) { "app.auth.jwt-secret must be at least 32 bytes" }
        return SecretKeySpec(bytes, "HmacSHA256")
    }

    @Bean
    fun jwtDecoder(key: SecretKey): JwtDecoder =
        NimbusJwtDecoder.withSecretKey(key).macAlgorithm(MacAlgorithm.HS256).build().apply {
            setJwtValidator(JwtValidators.createDefaultWithIssuer(ISSUER))
        }

    @Bean
    fun jwtEncoder(key: SecretKey): JwtEncoder = NimbusJwtEncoder(ImmutableSecret<SecurityContext>(key))

    /** bcrypt by default; stored as `{bcrypt}...` so the algorithm can be upgraded later. */
    @Bean
    fun passwordEncoder(): PasswordEncoder = PasswordEncoderFactories.createDelegatingPasswordEncoder()
}

private fun writeError(mapper: ObjectMapper, response: HttpServletResponse, status: Int, error: ApiError) {
    response.status = status
    response.contentType = MediaType.APPLICATION_JSON_VALUE
    mapper.writeValue(response.outputStream, error)
}

@Component
class JsonAuthEntryPoint(private val mapper: ObjectMapper) : AuthenticationEntryPoint {
    override fun commence(request: HttpServletRequest, response: HttpServletResponse, e: AuthenticationException) {
        response.setHeader("WWW-Authenticate", "Bearer")
        writeError(mapper, response, 401, ApiError("UNAUTHORIZED", "Sign in required, or your session has expired"))
    }
}

@Component
class JsonAccessDeniedHandler(private val mapper: ObjectMapper) : AccessDeniedHandler {
    override fun handle(request: HttpServletRequest, response: HttpServletResponse, e: AccessDeniedException) =
        writeError(mapper, response, 403, ApiError("FORBIDDEN", "You do not have permission to do this"))
}

@Service
class TokenService(
    private val encoder: JwtEncoder,
    private val clock: Clock,
    @Value("\${app.auth.token-ttl:8h}") private val ttl: Duration,
) {
    data class Issued(val token: String, val expiresAt: Instant)

    fun issue(user: CurrentUser): Issued {
        val now = clock.instant()
        val expires = now.plus(ttl)
        val claims = JwtClaimsSet.builder()
            .issuer(ISSUER)
            .subject(user.id)
            .issuedAt(now)
            .expiresAt(expires)
            .claim("name", user.displayName)
            .claim("tenant", user.tenantId)
            .claim("roles", listOf(user.globalRole.name))
            .build()
        val header = JwsHeader.with(MacAlgorithm.HS256).build()
        return Issued(encoder.encode(JwtEncoderParameters.from(header, claims)).tokenValue, expires)
    }
}

data class LoginRequest(val username: String? = null, val password: String? = null)

data class SessionUser(
    val id: String,
    val username: String,
    val displayName: String,
    val tenantId: String,
    val tenantName: String,
    val globalRole: GlobalRole,
)

data class LoginResponse(val token: String, val expiresAt: Instant, val user: SessionUser)

fun CurrentUser.toSession() = SessionUser(id, username, displayName, tenantId, tenantName, globalRole)

@RestController
@RequestMapping("/api/auth")
class AuthController(
    private val users: UserRepository,
    private val passwords: PasswordEncoder,
    private val tokens: TokenService,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    /** Compared against when the username is unknown, so response time does not reveal which usernames exist. */
    private val timingDummy: String by lazy { passwords.encode("timing-dummy-password")!! }

    @PostMapping("/login")
    fun login(@RequestBody request: LoginRequest): LoginResponse {
        val username = request.username?.trim()?.lowercase().orEmpty()
        val password = request.password.orEmpty()
        val creds = if (username.isEmpty()) null else users.findCredentials(username)
        val ok = if (creds == null) {
            passwords.matches(password, timingDummy)
            false
        } else {
            password.isNotEmpty() && passwords.matches(password, creds.passwordHash)
        }
        if (!ok || creds == null) {
            log.info("login failed") // the attempted username is not logged (may be personal data / a mistyped password)
            throw UnauthorizedException("Invalid username or password")
        }
        val issued = tokens.issue(creds.user)
        log.info("login succeeded userId={}", creds.user.id)
        return LoginResponse(issued.token, issued.expiresAt, creds.user.toSession())
    }

    @GetMapping("/me")
    fun me(@RequestAttribute(AuthInterceptor.ATTR) user: CurrentUser): SessionUser = user.toSession()
}

data class MembershipView(val projectId: String, val projectName: String, val role: Role)

data class AdminUserView(
    val id: String,
    val username: String,
    val displayName: String,
    val globalRole: GlobalRole,
    val memberships: List<MembershipView>,
    /** When the account was created or last changed by an admin. */
    val updatedAt: java.time.OffsetDateTime? = null,
)

/** Account overview for administrators, always limited to the administrator's own tenant. */
@RestController
@RequestMapping("/api/admin")
class AdminController(
    private val userAdmin: UserManagementService,
    private val accessLog: AccessLogRepository,
) {

    /** Who viewed which task or recording (allowed and denied), newest first, for tasks of the admin's tenant. */
    @GetMapping("/access-log")
    @PreAuthorize("hasRole('ADMIN')")
    fun accessLog(
        @RequestAttribute(AuthInterceptor.ATTR) admin: CurrentUser,
        @RequestParam("limit", defaultValue = "100") limit: Int,
    ): List<AccessLogView> = accessLog.recentForTenant(admin.tenantId, limit.coerceIn(1, 500))


    @GetMapping("/users")
    @PreAuthorize("hasRole('ADMIN')")
    fun users(@RequestAttribute(AuthInterceptor.ATTR) admin: CurrentUser): List<AdminUserView> = userAdmin.list(admin.tenantId)
}
