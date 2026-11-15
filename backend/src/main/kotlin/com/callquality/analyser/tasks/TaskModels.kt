package com.callquality.analyser.tasks

import com.fasterxml.jackson.databind.JsonNode
import com.callquality.analyser.auth.Role
import java.time.OffsetDateTime

enum class TaskStatus {
    IN_PROGRESS, SUBMITTED, APPROVED, CHANGES_REQUESTED;

    /**
     * IN_PROGRESS -> SUBMITTED -> APPROVED | CHANGES_REQUESTED, and CHANGES_REQUESTED -> SUBMITTED
     * (the rework loop the plan leaves implicit).
     */
    fun canTransitionTo(next: TaskStatus): Boolean = when (this) {
        IN_PROGRESS -> next == SUBMITTED
        CHANGES_REQUESTED -> next == SUBMITTED
        SUBMITTED -> next == APPROVED || next == CHANGES_REQUESTED
        APPROVED -> false
    }

    val editable: Boolean get() = this == IN_PROGRESS || this == CHANGES_REQUESTED
}

enum class ReviewDecision { APPROVE, REQUEST_CHANGES }

data class TaskRecord(
    val id: String,
    val projectId: String,
    val taskType: String,
    val schemaVersion: Int,
    val title: String,
    val input: JsonNode,
    val status: TaskStatus,
    val assigneeId: String?,
    val assigneeName: String?,
    val version: Long,
    val createdAt: OffsetDateTime,
    val updatedAt: OffsetDateTime,
)

data class AnnotationRecord(
    val id: String,
    val taskId: String,
    val payload: JsonNode,
    val version: Long,
    val updatedBy: String?,
    val updatedAt: OffsetDateTime,
)

data class ReviewView(
    val id: String,
    val reviewerId: String,
    val reviewerName: String,
    val decision: ReviewDecision,
    val comment: String?,
    val createdAt: OffsetDateTime,
)

data class AnnotationView(val payload: JsonNode, val version: Long, val updatedBy: String?, val updatedAt: OffsetDateTime)

data class TaskSummary(
    val id: String,
    val projectId: String,
    val taskType: String,
    val schemaVersion: Int,
    val title: String,
    val status: TaskStatus,
    val assigneeId: String?,
    val assigneeName: String?,
    val version: Long,
    val updatedAt: OffsetDateTime,
)

/** One page of a project's tasks, newest modification first. `counts` and `projectTotal` cover the whole project. */
data class TaskPage(
    val items: List<TaskSummary>,
    val total: Int,
    val page: Int,
    val size: Int,
    val projectTotal: Int,
    val counts: Map<TaskStatus, Int>,
    val types: List<String>,
)

data class TaskDetail(
    val id: String,
    val projectId: String,
    val taskType: String,
    val schemaVersion: Int,
    val title: String,
    val input: JsonNode,
    val status: TaskStatus,
    val assigneeId: String?,
    val assigneeName: String?,
    val version: Long,
    val viewerRole: Role,
    val canEdit: Boolean,
    val canReview: Boolean,
    val schema: JsonNode,
    val annotation: AnnotationView,
    val lastReview: ReviewView?,
    /** The speech model's first draft, when the task started from one (model-assisted annotation). */
    val draft: com.callquality.analyser.drafts.DraftView? = null,
)

data class SaveAnnotationRequest(val expectedVersion: Long, val payload: JsonNode)
data class SubmitRequest(val expectedVersion: Long)
data class ReviewRequest(val decision: ReviewDecision, val comment: String? = null)
