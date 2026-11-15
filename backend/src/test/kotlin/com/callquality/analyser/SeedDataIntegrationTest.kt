package com.callquality.analyser

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.callquality.analyser.annotations.TaskTypeRegistry
import com.callquality.analyser.demo.DemoDataSeeder
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.MediaType
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.ResultActions
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status

/** The realistic seed (from data/calls.json) must be consistent with what the real lifecycle produces. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SeedDataIntegrationTest {
    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var mapper: ObjectMapper
    @Autowired lateinit var seeder: DemoDataSeeder
    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var registry: TaskTypeRegistry

    private val tokens = mutableMapOf<String, String>()

    @BeforeEach
    fun reset() = seeder.reset()

    private fun json(r: ResultActions): JsonNode = mapper.readTree(r.andReturn().response.contentAsString)

    private fun token(username: String) = tokens.getOrPut(username) {
        val body = mapper.writeValueAsString(mapOf("username" to username, "password" to "Test123"))
        json(mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isOk))["token"].asText()
    }

    private fun call(b: MockHttpServletRequestBuilder, user: String, body: Any? = null): ResultActions {
        b.header("Authorization", "Bearer ${token(user)}")
        if (body != null) b.contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(body))
        return mvc.perform(b)
    }

    @Test
    fun `every task status is represented and every payload satisfies its task-type schema`() {
        val statuses = jdbc.queryForList("SELECT DISTINCT status FROM task", String::class.java).toSet()
        assertEquals(setOf("IN_PROGRESS", "SUBMITTED", "APPROVED", "CHANGES_REQUESTED"), statuses)
        val rows = jdbc.queryForList("SELECT t.id, t.task_type, t.input_json, a.payload_json FROM task t JOIN annotation a ON a.task_id = t.id")
        assertTrue(rows.size >= 18, "expected the realistic set to be seeded, got ${rows.size} tasks")
        for (row in rows) {
            val payload = mapper.readTree(row["payload_json"] as String)
            val problems = registry.validateForSave(row["task_type"] as String, 1, payload)
            assertTrue(problems.isEmpty(), "${row["id"]}: $problems")
            if (row["task_type"] == "TRANSCRIPTION") {
                val duration = mapper.readTree(row["input_json"] as String)["durationMs"].asInt()
                payload["segments"].forEach { assertTrue(it["endMs"].asInt() <= duration, "${row["id"]} segment past the end") }
            }
        }
    }

    @Test
    fun `submitted and reviewed tasks carry the same history the lifecycle would write`() {
        val approved = json(call(get("/api/tasks/t-call-04"), "bob").andExpect(status().isOk))
        assertEquals("APPROVED", approved["status"].asText())
        assertEquals("APPROVE", approved["lastReview"]["decision"].asText())
        val audit = json(call(get("/api/tasks/t-call-04/audit"), "bob"))
        assertEquals(listOf("TASK_SUBMITTED", "TASK_APPROVED"), audit.map { it["action"].asText() })

        // names in the transcript were pseudonymised on the way in
        val text = approved["annotation"]["payload"]["segments"][0]["text"].asText()
        assertTrue(text.contains("[PERSON_") && !text.contains("Keller"), text)
    }

    @Test
    fun `seeded tasks keep working through the real lifecycle`() {
        // Bob reviews a seeded submission
        call(post("/api/tasks/t-call-03/review"), "bob", mapOf("decision" to "APPROVE", "comment" to "ok"))
            .andExpect(status().isOk).andExpect(jsonPath("$.status").value("APPROVED"))

        // Alice fixes the speaker the reviewer flagged and resubmits
        val task = json(call(get("/api/tasks/t-call-05"), "alice"))
        assertEquals("CHANGES_REQUESTED", task["status"].asText())
        assertTrue(task["canEdit"].asBoolean())
        val version = task["annotation"]["version"].asLong()
        val fixed = mapper.convertValue(task["annotation"]["payload"], Map::class.java).toMutableMap()
        @Suppress("UNCHECKED_CAST")
        val segments = (fixed["segments"] as List<Map<String, Any?>>).mapIndexed { i, s -> if (i == 1) s + ("speaker" to "CUSTOMER") else s }
        call(put("/api/tasks/t-call-05/annotation"), "alice", mapOf("expectedVersion" to version, "payload" to mapOf("segments" to segments)))
            .andExpect(status().isOk)
        call(post("/api/tasks/t-call-05/submit"), "alice", mapOf("expectedVersion" to version + 1))
            .andExpect(status().isOk).andExpect(jsonPath("$.status").value("SUBMITTED"))
    }

    @Test
    fun `roles are per project`() {
        val projects = json(call(get("/api/me/projects"), "alice"))
        assertEquals(mapOf("Loan calls (demo)" to "ANNOTATOR", "Mortgage follow-ups (demo)" to "REVIEWER"),
            projects.associate { it["name"].asText() to it["role"].asText() })
        // Alice may review Erik's handover, but not approve anything in the project where she annotates
        call(get("/api/tasks/t-call-08"), "alice").andExpect(jsonPath("$.canReview").value(true))
        call(post("/api/tasks/t-call-07/review"), "alice", mapOf("decision" to "APPROVE")).andExpect(status().isForbidden)
    }
}
