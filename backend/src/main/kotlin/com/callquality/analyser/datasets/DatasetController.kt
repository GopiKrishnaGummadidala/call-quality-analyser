package com.callquality.analyser.datasets

import com.callquality.analyser.auth.AuthInterceptor
import com.callquality.analyser.auth.CurrentUser
import org.springframework.http.CacheControl
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestAttribute
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

/** Training-data releases. Administrators only, always scoped to their own organisation. */
@RestController
@RequestMapping("/api/admin")
@PreAuthorize("hasRole('ADMIN')")
class DatasetController(private val datasets: DatasetService) {

    @GetMapping("/projects")
    fun projects(@RequestAttribute(AuthInterceptor.ATTR) admin: CurrentUser): List<ProjectDataView> = datasets.projects(admin)

    @GetMapping("/projects/{projectId}/datasets")
    fun releases(
        @RequestAttribute(AuthInterceptor.ATTR) admin: CurrentUser,
        @PathVariable("projectId") projectId: String,
    ): List<ReleaseView> = datasets.releases(admin, projectId)

    @PostMapping("/projects/{projectId}/datasets")
    fun create(
        @RequestAttribute(AuthInterceptor.ATTR) admin: CurrentUser,
        @PathVariable("projectId") projectId: String,
    ): ResponseEntity<ReleaseView> = ResponseEntity.status(HttpStatus.CREATED).body(datasets.createRelease(admin, projectId))

    @GetMapping("/datasets/{releaseId}")
    fun detail(
        @RequestAttribute(AuthInterceptor.ATTR) admin: CurrentUser,
        @PathVariable("releaseId") releaseId: String,
    ): ReleaseDetail = datasets.detail(admin, releaseId)

    /** JSON Lines manifest; the SHA-256 header lets a training job verify it received exactly this release. */
    @GetMapping("/datasets/{releaseId}/manifest.jsonl")
    fun manifest(
        @RequestAttribute(AuthInterceptor.ATTR) admin: CurrentUser,
        @PathVariable("releaseId") releaseId: String,
    ): ResponseEntity<ByteArray> {
        val m = datasets.manifest(admin, releaseId)
        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType("application/x-ndjson"))
            .cacheControl(CacheControl.noStore().cachePrivate())
            .header("Content-Disposition", "attachment; filename=\"${m.fileName}\"")
            .header("X-Manifest-SHA256", m.sha256)
            .body(m.body)
    }
}
