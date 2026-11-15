package com.callquality.analyser.common

import com.callquality.analyser.auth.AuthInterceptor
import com.callquality.analyser.auth.CurrentUser
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.slf4j.LoggerFactory
import org.slf4j.MDC
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter
import java.util.UUID

/**
 * Adds a correlationId to every request (MDC + response header) and logs one line per request.
 * Logged: method, path, status, duration, user id. Never logged: bodies, query strings, headers (incl. tokens).
 * Runs before the security filter chain so rejected (401/403) requests are logged and correlated too.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class CorrelationIdFilter : OncePerRequestFilter() {
    private val log = LoggerFactory.getLogger(javaClass)
    private val valid = Regex("[A-Za-z0-9_-]{1,64}")

    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, chain: FilterChain) {
        val incoming = request.getHeader("X-Correlation-Id")
        val id = if (incoming != null && valid.matches(incoming)) incoming else UUID.randomUUID().toString()
        MDC.put("correlationId", id)
        response.setHeader("X-Correlation-Id", id)
        val start = System.nanoTime()
        try {
            chain.doFilter(request, response)
        } finally {
            val ms = (System.nanoTime() - start) / 1_000_000
            val user = request.getAttribute(AuthInterceptor.ATTR) as? CurrentUser
            log.info(
                "request completed method={} path={} status={} durationMs={} userId={}",
                request.method, request.requestURI, response.status, ms, user?.id ?: "-",
            )
            MDC.remove("correlationId")
        }
    }
}
