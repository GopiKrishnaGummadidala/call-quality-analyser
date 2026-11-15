package com.callquality.analyser.tasks

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.node.ObjectNode
import com.callquality.analyser.annotations.TaskTypeRegistry
import com.callquality.analyser.audit.AccessAction
import com.callquality.analyser.audit.AccessLogRepository
import com.callquality.analyser.audit.AccessOutcome
import com.callquality.analyser.audit.AuditRepository
import com.callquality.analyser.auth.AccessService
import com.callquality.analyser.auth.CurrentUser
import com.callquality.analyser.auth.Role
import com.callquality.analyser.common.ConflictException
import com.callquality.analyser.common.ForbiddenException
import com.callquality.analyser.common.NotFoundException
import com.callquality.analyser.common.ValidationFailedException
import org.springframework.core.io.ClassPathResource
import org.springframework.core.io.Resource
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.OffsetDateTime

/**
 * Owns every state transition. Each mutating method:
 *   1. authorizes against project membership BEFORE taking any lock,
 *   2. locks the task row and re-reads it (serializes save / submit / review),
 *   3. validates state + payload, 4. writes, 5. inserts the audit event, all in one transaction.
 */
/** Largest page the task list returns; the queue asks for 10, 25 or 50. */
const val MAX_PAGE_SIZE = 100

@Service
class TaskService(
    private val repo: TaskRepository,
    private val access: AccessService,
    private val registry: TaskTypeRegistry,
    private val audit: AuditRepository,
    private val accessLog: AccessLogRepository,
    private val drafts: com.callquality.analyser.drafts.DraftRepository,
    private val clock: Clock,
) {
    fun list(user: CurrentUser, projectId: String, status: TaskStatus?, type: String?, query: String?, page: Int, size: Int): TaskPage {
        access.requireMember(user, projectId)
        val pageSize = size.coerceIn(1, MAX_PAGE_SIZE)
        val pageIndex = page.coerceAtLeast(0)
        val (records, total) = repo.page(projectId, status, type, query, pageIndex * pageSize, pageSize)
        val counts = repo.statusCounts(projectId)
        return TaskPage(
            items = records.map {
                TaskSummary(
                    it.id, it.projectId, it.taskType, it.schemaVersion, it.title, it.status,
                    it.assigneeId, it.assigneeName, it.version, it.updatedAt,
                )
            },
            total = total, page = pageIndex, size = pageSize,
            projectTotal = counts.values.sum(),
            counts = TaskStatus.entries.associateWith { counts[it] ?: 0 },
            types = repo.taskTypes(projectId),
        )
    }

    fun get(user: CurrentUser, taskId: String): TaskDetail {
        val (task, role) = authorizeRead(user, taskId, AccessAction.VIEW_TASK)
        return detail(user, task, role)
    }

    /**
     * The task's recording, for project members only. Recordings are never served as public static files: the
     * browser fetches them through this endpoint with the user's token, and every fetch is access-logged.
     */
    fun audio(user: CurrentUser, taskId: String): Resource {
        val (task, _) = authorizeRead(user, taskId, AccessAction.READ_AUDIO)
        val name = audioFileName(task) ?: throw NotFoundException("Not found")
        val clip = ClassPathResource("$AUDIO_DIR/$name")
        if (!clip.exists()) throw NotFoundException("Not found")
        return clip
    }

    @Transactional
    fun saveAnnotation(user: CurrentUser, taskId: String, expectedVersion: Long, payload: JsonNode): AnnotationView {
        val (task, _) = lockAndAuthorize(user, taskId)
        if (task.assigneeId != user.id) throw ForbiddenException("Only the assignee can edit this task")
        if (!task.status.editable) {
            throw ConflictException("INVALID_STATE", "Task is ${task.status} and can no longer be edited")
        }
        val violations = registry.validateForSave(task.taskType, task.schemaVersion, payload)
        if (violations.isNotEmpty()) throw ValidationFailedException(violations)

        val changed = repo.updateAnnotation(task.id, expectedVersion, payload, user.id, OffsetDateTime.now(clock))
        if (changed == 0) {
            throw ConflictException("STALE_VERSION", "The annotation was changed elsewhere. Reload to see the latest version.")
        }
        return view(repo.findAnnotation(task.id)!!)
    }

    @Transactional
    fun submit(user: CurrentUser, taskId: String, expectedVersion: Long): TaskDetail {
        val (task, role) = lockAndAuthorize(user, taskId)
        if (task.assigneeId != user.id) throw ForbiddenException("Only the assignee can submit this task")
        requireTransition(task, TaskStatus.SUBMITTED)

        val annotation = repo.findAnnotation(task.id) ?: throw IllegalStateException("annotation missing")
        if (annotation.version != expectedVersion) {
            throw ConflictException("STALE_VERSION", "The annotation was changed elsewhere. Reload to see the latest version.")
        }
        val violations = registry.validateForSubmit(task.taskType, task.schemaVersion, annotation.payload)
        if (violations.isNotEmpty()) throw ValidationFailedException(violations)

        transition(task, TaskStatus.SUBMITTED)
        audit.insert(
            task.projectId, "TASK", task.id, user.id, "TASK_SUBMITTED",
            mapOf("fromStatus" to task.status.name, "toStatus" to TaskStatus.SUBMITTED.name, "annotationVersion" to annotation.version),
        )
        return detail(user, repo.find(task.id)!!, role)
    }

    @Transactional
    fun review(user: CurrentUser, taskId: String, decision: ReviewDecision, comment: String?): TaskDetail {
        val (task, role) = lockAndAuthorize(user, taskId)
        if (role != Role.REVIEWER) throw ForbiddenException("Only reviewers can review tasks")
        // Four-eyes principle: nobody reviews their own work.
        if (task.assigneeId == user.id) throw ForbiddenException("You cannot review your own task")

        val target = if (decision == ReviewDecision.APPROVE) TaskStatus.APPROVED else TaskStatus.CHANGES_REQUESTED
        requireTransition(task, target)
        val trimmed = comment?.trim()
        if (decision == ReviewDecision.REQUEST_CHANGES && trimmed.isNullOrEmpty()) {
            throw ValidationFailedException(listOf("A reason is required when requesting changes"))
        }

        val reviewId = repo.insertReview(task.id, user.id, decision, trimmed?.ifEmpty { null }, OffsetDateTime.now(clock))
        transition(task, target)
        audit.insert(
            task.projectId, "TASK", task.id, user.id,
            if (decision == ReviewDecision.APPROVE) "TASK_APPROVED" else "TASK_CHANGES_REQUESTED",
            mapOf("fromStatus" to task.status.name, "toStatus" to target.name, "reviewId" to reviewId),
        )
        return detail(user, repo.find(task.id)!!, role)
    }

    // ---- helpers -------------------------------------------------------------------------------

    /**
     * Read path: membership check + access log. The log entry is written before any data is returned, and a denied
     * attempt is logged too (unknown task ids are not: there is nothing to protect and no project to file it under).
     */
    private fun authorizeRead(user: CurrentUser, taskId: String, action: AccessAction): Pair<TaskRecord, Role> {
        val task = repo.find(taskId) ?: throw NotFoundException("Not found")
        val role = access.roleInProject(user, task.projectId)
        if (role == null) {
            accessLog.record(task.projectId, task.id, user.id, action, AccessOutcome.DENIED)
            throw NotFoundException("Not found")
        }
        accessLog.record(task.projectId, task.id, user.id, action, AccessOutcome.ALLOWED)
        return task to role
    }

    /** Stored inputs name the recording (e.g. "/audio/dict-01.wav"); only a plain file name is ever resolved. */
    private fun audioFileName(task: TaskRecord): String? {
        if (task.taskType != "TRANSCRIPTION") return null
        val name = task.input.path("audioUrl").asText("").substringAfterLast('/')
        return name.takeIf { SAFE_AUDIO_NAME.matches(it) }
    }

    /** Clients get the protected API URL, never the storage location. */
    private fun clientInput(task: TaskRecord): JsonNode {
        val name = audioFileName(task) ?: return task.input
        return (task.input.deepCopy() as ObjectNode)
            .put("audioUrl", "/api/tasks/${task.id}/audio")
            .put("audioName", name)
    }

    private fun lockAndAuthorize(user: CurrentUser, taskId: String): Pair<TaskRecord, Role> {
        val probe = repo.find(taskId) ?: throw NotFoundException("Not found")
        val role = access.requireMember(user, probe.projectId) // authorize before locking
        repo.lock(taskId)
        val fresh = repo.find(taskId) ?: throw NotFoundException("Not found") // re-read under the lock
        return fresh to role
    }

    private fun requireTransition(task: TaskRecord, next: TaskStatus) {
        if (!task.status.canTransitionTo(next)) {
            throw ConflictException("INVALID_TRANSITION", "Cannot move a task from ${task.status} to $next")
        }
    }

    private fun transition(task: TaskRecord, next: TaskStatus) {
        val changed = repo.updateStatus(task.id, task.status, next, OffsetDateTime.now(clock))
        if (changed != 1) throw ConflictException("INVALID_TRANSITION", "Task status changed concurrently")
    }

    private fun view(a: AnnotationRecord) = AnnotationView(a.payload, a.version, a.updatedBy, a.updatedAt)

    private fun detail(user: CurrentUser, task: TaskRecord, role: Role): TaskDetail {
        val annotation = repo.findAnnotation(task.id) ?: throw IllegalStateException("annotation missing")
        val isAssignee = task.assigneeId == user.id
        return TaskDetail(
            id = task.id,
            projectId = task.projectId,
            taskType = task.taskType,
            schemaVersion = task.schemaVersion,
            title = task.title,
            input = clientInput(task),
            status = task.status,
            assigneeId = task.assigneeId,
            assigneeName = task.assigneeName,
            version = task.version,
            viewerRole = role,
            canEdit = isAssignee && task.status.editable,
            canReview = role == Role.REVIEWER && !isAssignee && task.status == TaskStatus.SUBMITTED,
            schema = registry.schemaJson(task.taskType, task.schemaVersion),
            annotation = view(annotation),
            lastReview = repo.lastReview(task.id),
            draft = drafts.find(task.id),
        )
    }

    companion object {
        /** Classpath folder holding the recordings (generated by scripts/generate-audio.ps1). */
        const val AUDIO_DIR = "audio"
        private val SAFE_AUDIO_NAME = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,100}\\.wav$")
    }
}
