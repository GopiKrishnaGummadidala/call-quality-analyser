package com.callquality.analyser.common

import org.slf4j.LoggerFactory
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.http.converter.HttpMessageNotReadableException
import org.springframework.security.access.AccessDeniedException
import org.springframework.security.core.AuthenticationException
import org.springframework.web.ErrorResponse
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException

@RestControllerAdvice
class ApiExceptionHandler {
    private val log = LoggerFactory.getLogger(javaClass)

    private fun respond(status: HttpStatus, error: ApiError) = ResponseEntity.status(status).body(error)

    @ExceptionHandler(UnauthorizedException::class)
    fun unauthorized(e: UnauthorizedException) = respond(HttpStatus.UNAUTHORIZED, ApiError("UNAUTHORIZED", e.message ?: "Unauthorized"))

    @ExceptionHandler(ForbiddenException::class)
    fun forbidden(e: ForbiddenException) = respond(HttpStatus.FORBIDDEN, ApiError("FORBIDDEN", e.message ?: "Forbidden"))

    // Thrown by @PreAuthorize inside controllers (outside the security filter chain's own handlers).
    @ExceptionHandler(AccessDeniedException::class)
    fun accessDenied(e: AccessDeniedException) = respond(HttpStatus.FORBIDDEN, ApiError("FORBIDDEN", "You do not have permission to do this"))

    @ExceptionHandler(AuthenticationException::class)
    fun authentication(e: AuthenticationException) = respond(HttpStatus.UNAUTHORIZED, ApiError("UNAUTHORIZED", "Sign in required"))

    @ExceptionHandler(NotFoundException::class)
    fun notFound(e: NotFoundException) = respond(HttpStatus.NOT_FOUND, ApiError("NOT_FOUND", e.message ?: "Not found"))

    @ExceptionHandler(ConflictException::class)
    fun conflict(e: ConflictException) = respond(HttpStatus.CONFLICT, ApiError(e.code, e.message ?: "Conflict"))

    @ExceptionHandler(ValidationFailedException::class)
    fun invalid(e: ValidationFailedException) =
        respond(HttpStatus.UNPROCESSABLE_ENTITY, ApiError("VALIDATION_FAILED", "Validation failed", e.violations))

    // Deliberately do not echo the exception message: parse errors can quote request content.
    @ExceptionHandler(HttpMessageNotReadableException::class, MethodArgumentTypeMismatchException::class)
    fun badRequest(e: Exception) = respond(HttpStatus.BAD_REQUEST, ApiError("BAD_REQUEST", "Malformed request"))

    @ExceptionHandler(Exception::class)
    fun unexpected(e: Exception): ResponseEntity<ApiError> {
        if (e is ErrorResponse) {
            val status = HttpStatus.valueOf(e.statusCode.value())
            return respond(status, ApiError(status.name, status.reasonPhrase))
        }
        // Log only the exception type (the message may contain sensitive content).
        log.error("unhandled error type={}", e.javaClass.name)
        return respond(HttpStatus.INTERNAL_SERVER_ERROR, ApiError("INTERNAL_ERROR", "Unexpected error"))
    }
}
