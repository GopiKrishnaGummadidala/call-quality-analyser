package com.callquality.analyser

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.callquality.analyser.audit.AuditRepository
import com.callquality.analyser.demo.DemoDataSeeder
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.anyMap
import org.mockito.ArgumentMatchers.anyString
import org.mockito.Mockito.doThrow
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.ResultActions
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class WorkflowIntegrationTest {
    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var mapper: ObjectMapper
    @Autowired lateinit var seeder: DemoDataSeeder
    @Autowired lateinit var auditRepo: AuditRepository
    @MockitoSpyBean lateinit var auditSpy: AuditRepository

    private val alice = "u-alice"
    private val bob = "u-bob"
    private val carol = "u-carol"
    private val task = "t-audio-1"

    @BeforeEach
    fun reset() = seeder.reset()

    // ---- helpers ---------------------------------------------------------------------------

    private val tokens = mutableMapOf<String, String>()

    /** Signs in through the real login endpoint (user id "u-alice" -> username "alice", demo password). */
    private fun token(user: String): String = tokens.getOrPut(user) {
        val body = mapOf("username" to user.removePrefix("u-"), "password" to "Test123")
        val r = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(body)))
            .andExpect(status().isOk)
        json(r)["token"].asText()
    }

    private fun call(builder: org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder, user: String, body: Any? = null): ResultActions {
        builder.header("Authorization", "Bearer ${token(user)}")
        if (body != null) builder.contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(body))
        return mvc.perform(builder)
    }

    private fun json(r: ResultActions): JsonNode = mapper.readTree(r.andReturn().response.contentAsString)

    private fun completePayload(): Map<String, Any> = mapOf(
        "segments" to listOf(
            mapOf("id" to "s1", "startMs" to 0, "endMs" to 3000, "speaker" to "AGENT", "label" to "CLEAR", "text" to "hello"),
            // overlaps s1 on purpose: overlapping speech is allowed
            mapOf("id" to "s2", "startMs" to 2000, "endMs" to 5000, "speaker" to "CUSTOMER", "label" to "CROSSTALK", "text" to "hi"),
        ),
    )

    private fun save(user: String, version: Long, payload: Any = completePayload(), id: String = task) =
        call(put("/api/tasks/$id/annotation"), user, mapOf("expectedVersion" to version, "payload" to payload))

    private fun submit(user: String, version: Long, id: String = task) =
        call(post("/api/tasks/$id/submit"), user, mapOf("expectedVersion" to version))

    private fun review(user: String, decision: String, comment: String? = null, id: String = task) =
        call(post("/api/tasks/$id/review"), user, mapOf("decision" to decision, "comment" to comment))

    private fun taskStatus(id: String = task, user: String = alice): String = json(call(get("/api/tasks/$id"), user))["status"].asText()

    private fun annotationText(user: String = alice): String =
        json(call(get("/api/tasks/$task"), user))["annotation"]["payload"]["segments"][0]["text"].asText()

    // ---- 1. valid save + submit ------------------------------------------------------------

    @Test
    fun `annotator saves and submits, task becomes read-only and audit records it once`() {
        save(alice, 0).andExpect(status().isOk).andExpect(jsonPath("$.version").value(1))
        submit(alice, 1).andExpect(status().isOk).andExpect(jsonPath("$.status").value("SUBMITTED")).andExpect(jsonPath("$.canEdit").value(false))

        // no silent edits after submit
        save(alice, 1).andExpect(status().isConflict).andExpect(jsonPath("$.code").value("INVALID_STATE"))

        val events = json(call(get("/api/tasks/$task/audit"), bob))
        assertEquals(1, events.size())
        assertEquals("TASK_SUBMITTED", events[0]["action"].asText())
        assertEquals(alice, events[0]["actorId"].asText())
    }

    @Test
    fun `submit with incomplete transcript is rejected with actionable feedback`() {
        submit(alice, 0).andExpect(status().is4xxClientError).andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
            .andExpect(jsonPath("$.violations[0]").value("Segment 2: transcript text is required"))
        assertEquals("IN_PROGRESS", taskStatus())
        assertEquals(0, auditRepo.countForEntity("TASK", task))
    }

    // ---- 2. invalid transition -------------------------------------------------------------

    @Test
    fun `invalid transitions are rejected server-side`() {
        save(alice, 0)
        submit(alice, 1).andExpect(status().isOk)
        submit(alice, 1).andExpect(status().isConflict).andExpect(jsonPath("$.code").value("INVALID_TRANSITION"))
        review(bob, "APPROVE").andExpect(status().isOk)
        review(bob, "REQUEST_CHANGES", "too late").andExpect(status().isConflict).andExpect(jsonPath("$.code").value("INVALID_TRANSITION"))
        assertEquals("APPROVED", taskStatus())
    }

    // ---- 3. reviewer role and state --------------------------------------------------------

    @Test
    fun `review enforces role and state`() {
        // not submitted yet
        review(bob, "APPROVE").andExpect(status().isConflict).andExpect(jsonPath("$.code").value("INVALID_TRANSITION"))
        save(alice, 0)
        submit(alice, 1)
        // annotator cannot review
        review(alice, "APPROVE").andExpect(status().isForbidden)
        // request changes needs a reason
        review(bob, "REQUEST_CHANGES", "  ").andExpect(status().isUnprocessableEntity)
        review(bob, "REQUEST_CHANGES", "Please fix segment 2").andExpect(status().isOk)
            .andExpect(jsonPath("$.status").value("CHANGES_REQUESTED"))
            .andExpect(jsonPath("$.lastReview.comment").value("Please fix segment 2"))
        // rework loop: annotator can edit and resubmit
        save(alice, 1, completePayload()).andExpect(status().isOk)
        submit(alice, 2).andExpect(status().isOk).andExpect(jsonPath("$.status").value("SUBMITTED"))
        review(bob, "APPROVE").andExpect(status().isOk).andExpect(jsonPath("$.status").value("APPROVED"))
    }

    // ---- 4. cross-project / tenant denial --------------------------------------------------

    @Test
    fun `users outside the project cannot read or write anything`() {
        call(get("/api/projects/proj-a/tasks"), carol).andExpect(status().isNotFound)
        call(get("/api/tasks/$task"), carol).andExpect(status().isNotFound)
        save(carol, 0).andExpect(status().isNotFound)
        submit(carol, 0).andExpect(status().isNotFound)
        review(carol, "APPROVE").andExpect(status().isNotFound)
        call(get("/api/tasks/$task/audit"), carol).andExpect(status().isNotFound)
        call(get("/api/projects/proj-a/evaluation"), carol).andExpect(status().isNotFound)
        // and the reverse direction
        call(get("/api/tasks/t-b-1"), alice).andExpect(status().isNotFound)
        assertEquals("IN_PROGRESS", taskStatus())
    }

    @Test
    fun `missing token, bare user id header or invalid token is unauthorized`() {
        mvc.perform(get("/api/me/projects")).andExpect(status().isUnauthorized)
        // the old demo header no longer authenticates anyone
        mvc.perform(get("/api/me/projects").header("X-User-Id", alice)).andExpect(status().isUnauthorized)
        mvc.perform(get("/api/me/projects").header("Authorization", "Bearer not-a-token")).andExpect(status().isUnauthorized)
    }

    // ---- 5. stale version ------------------------------------------------------------------

    @Test
    fun `stale write returns 409 and does not overwrite the latest annotation`() {
        fun payloadWith(text: String) = mapOf(
            "segments" to listOf(mapOf("id" to "s1", "startMs" to 0, "endMs" to 1000, "speaker" to "OTHER", "label" to "CLEAR", "text" to text)),
        )
        save(alice, 0, payloadWith("first tab")).andExpect(status().isOk)           // N -> N+1
        save(alice, 0, payloadWith("second tab")).andExpect(status().isConflict)    // still based on N
            .andExpect(jsonPath("$.code").value("STALE_VERSION"))
        assertEquals("first tab", annotationText())
    }

    @Test
    fun `annotator with a stale editor cannot save after the reviewer acted`() {
        save(alice, 0)
        submit(alice, 1)
        review(bob, "REQUEST_CHANGES", "Fix it")
        // the reviewer changed status/version; a save from an editor opened before submit is based on an old version
        save(alice, 0).andExpect(status().isConflict).andExpect(jsonPath("$.code").value("STALE_VERSION"))
    }

    // ---- 6. transactional audit ------------------------------------------------------------

    @Test
    fun `audit event and transition roll back together when the audit write fails`() {
        save(alice, 0)
        doThrow(RuntimeException("audit store down"))
            .`when`(auditSpy).insert(anyString(), anyString(), anyString(), anyString(), anyString(), anyMap())

        submit(alice, 1).andExpect(status().isInternalServerError)

        assertEquals("IN_PROGRESS", taskStatus())                       // state change rolled back
        assertEquals(0, auditRepo.countForEntity("TASK", task))     // and no orphan audit event
    }

    // ---- extras ----------------------------------------------------------------------------

    @Test
    fun `structurally invalid payloads are rejected by the task-type schema`() {
        save(alice, 0, mapOf("segments" to listOf(mapOf("id" to "s1", "startMs" to 0, "endMs" to 10, "speaker" to "ROBOT", "label" to "CLEAR", "text" to "x"))))
            .andExpect(status().isUnprocessableEntity)
        save(alice, 0, mapOf("segments" to listOf(mapOf("id" to "s1", "startMs" to 500, "endMs" to 100, "speaker" to "OTHER", "label" to "CLEAR", "text" to "x"))))
            .andExpect(status().isUnprocessableEntity)
    }

    @Test
    fun `second task type reuses the same lifecycle`() {
        val id = "t-score-1"
        val checks = listOf(
            "IDENTITY_VERIFIED", "PURPOSE_STATED", "AFFORDABILITY_CHECKED", "COSTS_DISCLOSED",
            "WITHDRAWAL_RIGHTS_EXPLAINED", "NO_PRESSURE_SELLING", "NEXT_STEPS_CONFIRMED",
        )
        // a failed check needs notes, and a call with a failed check cannot be scored compliant
        val failing = checks.associateWith { if (it == "NO_PRESSURE_SELLING") "FAIL" else "PASS" }
        save(alice, 0, mapOf("checks" to failing, "outcome" to "COMPLIANT", "notes" to ""), id).andExpect(status().isOk)
        submit(alice, 1, id).andExpect(status().isUnprocessableEntity)
            .andExpect(jsonPath("$.violations[0]").value("Notes are required when a check fails"))
            .andExpect(jsonPath("$.violations[1]").value("A call with a failed check cannot be compliant"))
        save(alice, 1, mapOf("checks" to checks.associateWith { "PASS" }, "outcome" to "COMPLIANT", "notes" to ""), id).andExpect(status().isOk)
        submit(alice, 2, id).andExpect(status().isOk).andExpect(jsonPath("$.status").value("SUBMITTED"))
        review(bob, "APPROVE", null, id).andExpect(status().isOk).andExpect(jsonPath("$.status").value("APPROVED"))
    }

    @Test
    fun `evaluation is computed from fixtures and lower for the candidate model`() {
        val report = json(call(get("/api/projects/proj-a/evaluation"), bob))
        assertEquals("WER", report["metric"].asText())
        assertEquals(4, report["datasetSize"].asInt())
        val models = report["models"]
        assertEquals(2, models.size())
        val a = models[0]["wer"].asDouble()
        val b = models[1]["wer"].asDouble()
        assertEquals(true, b < a)
    }
}
