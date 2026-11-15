package com.callquality.analyser.tasks

import com.callquality.analyser.auth.AuthInterceptor
import com.callquality.analyser.auth.CurrentUser
import com.callquality.analyser.auth.Role
import org.springframework.core.io.Resource
import org.springframework.http.CacheControl
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.core.RowMapper
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestAttribute
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

data class ProjectView(val id: String, val name: String, val role: Role)

@RestController
@RequestMapping("/api")
class TaskController(private val tasks: TaskService, private val jdbc: JdbcTemplate) {

    @GetMapping("/me/projects")
    fun myProjects(@RequestAttribute(AuthInterceptor.ATTR) user: CurrentUser): List<ProjectView> =
        jdbc.query(
            """
            SELECT p.id, p.name, m.role FROM project p
            JOIN project_membership m ON m.project_id = p.id
            WHERE m.user_id = ? AND p.tenant_id = ? ORDER BY p.name
            """.trimIndent(),
            RowMapper<ProjectView> { rs, _ -> ProjectView(rs.getString(1), rs.getString(2), Role.valueOf(rs.getString(3))) },
            user.id, user.tenantId,
        )

    @GetMapping("/projects/{projectId}/tasks")
    fun list(
        @RequestAttribute(AuthInterceptor.ATTR) user: CurrentUser,
        @PathVariable("projectId") projectId: String,
        @RequestParam("status", required = false) status: TaskStatus?,
        @RequestParam("type", required = false) type: String?,
        @RequestParam("q", required = false) query: String?,
        @RequestParam("page", defaultValue = "0") page: Int,
        @RequestParam("size", defaultValue = "25") size: Int,
    ): TaskPage = tasks.list(user, projectId, status, type, query, page, size)

    @GetMapping("/tasks/{taskId}")
    fun get(
        @RequestAttribute(AuthInterceptor.ATTR) user: CurrentUser,
        @PathVariable("taskId") taskId: String,
    ): TaskDetail = tasks.get(user, taskId)

    /** The recording of a transcription task: members only, never cached, every fetch access-logged. */
    @GetMapping("/tasks/{taskId}/audio")
    fun audio(
        @RequestAttribute(AuthInterceptor.ATTR) user: CurrentUser,
        @PathVariable("taskId") taskId: String,
    ): ResponseEntity<Resource> =
        ResponseEntity.ok()
            .contentType(MediaType.parseMediaType("audio/wav"))
            .cacheControl(CacheControl.noStore().cachePrivate())
            .header("Content-Disposition", "inline")
            .body(tasks.audio(user, taskId))

    @PutMapping("/tasks/{taskId}/annotation")
    fun save(
        @RequestAttribute(AuthInterceptor.ATTR) user: CurrentUser,
        @PathVariable("taskId") taskId: String,
        @RequestBody body: SaveAnnotationRequest,
    ): AnnotationView = tasks.saveAnnotation(user, taskId, body.expectedVersion, body.payload)

    @PostMapping("/tasks/{taskId}/submit")
    fun submit(
        @RequestAttribute(AuthInterceptor.ATTR) user: CurrentUser,
        @PathVariable("taskId") taskId: String,
        @RequestBody body: SubmitRequest,
    ): TaskDetail = tasks.submit(user, taskId, body.expectedVersion)

    @PostMapping("/tasks/{taskId}/review")
    fun review(
        @RequestAttribute(AuthInterceptor.ATTR) user: CurrentUser,
        @PathVariable("taskId") taskId: String,
        @RequestBody body: ReviewRequest,
    ): TaskDetail = tasks.review(user, taskId, body.decision, body.comment)
}
