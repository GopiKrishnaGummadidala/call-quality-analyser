package com.callquality.analyser.common

class UnauthorizedException(message: String) : RuntimeException(message)
class ForbiddenException(message: String) : RuntimeException(message)
class NotFoundException(message: String) : RuntimeException(message)

/** HTTP 409. [code] lets clients tell STALE_VERSION from INVALID_TRANSITION / INVALID_STATE. */
class ConflictException(val code: String, message: String) : RuntimeException(message)

/** HTTP 422 with human-readable, actionable violations (never includes payload content). */
class ValidationFailedException(val violations: List<String>) : RuntimeException("Validation failed")

data class ApiError(val code: String, val message: String, val violations: List<String> = emptyList())
