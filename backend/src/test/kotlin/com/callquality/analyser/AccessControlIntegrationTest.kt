package com.callquality.analyser

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
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
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.header
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status

/** Recordings are only reachable through the API, and every read of a task or recording is access-logged. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AccessControlIntegrationTest {
    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var mapper: ObjectMapper
    @Autowired lateinit var seeder: DemoDataSeeder
    @Autowired lateinit var jdbc: JdbcTemplate

    private val tokens = mutableMapOf<String, String>()

    @BeforeEach
    fun reset() = seeder.reset()

    private fun json(r: ResultActions): JsonNode = mapper.readTree(r.andReturn().response.contentAsString)

    private fun token(username: String) = tokens.getOrPut(username) {
        val body = mapper.writeValueAsString(mapOf("username" to username, "password" to "Test123"))
        json(mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isOk))["token"].asText()
    }

    private fun call(b: MockHttpServletRequestBuilder, user: String): ResultActions =
        mvc.perform(b.header("Authorization", "Bearer ${token(user)}"))

    private fun logRows(taskId: String): List<Pair<String, String>> =
        jdbc.query(
            "SELECT l.action, l.outcome, u.username FROM access_log l JOIN app_user u ON u.id = l.user_id WHERE l.task_id = ? ORDER BY l.seq",
            { rs, _ -> "${rs.getString(1)}/${rs.getString(2)}" to rs.getString(3) },
            taskId,
        )

    @Test
    fun `recordings are served to project members only, never cached`() {
        mvc.perform(get("/api/tasks/t-call-01/audio")).andExpect(status().isUnauthorized)
        call(get("/api/tasks/t-call-01/audio"), "carol").andExpect(status().isNotFound) // other organisation
        call(get("/api/tasks/t-call-01/audio"), "admin").andExpect(status().isNotFound) // admin is no project member

        val res = call(get("/api/tasks/t-call-01/audio"), "bob")
            .andExpect(status().isOk)
            .andExpect(header().string("Content-Type", "audio/wav"))
            .andExpect(header().string("Cache-Control", "no-store, private"))
            .andReturn().response
        val bytes = res.contentAsByteArray
        assertEquals("RIFF", String(bytes, 0, 4), "a WAV file")
        assertTrue(bytes.size > 100_000, "the real recording, ${bytes.size} bytes")

        // text tasks have no recording
        call(get("/api/tasks/t-score-01/audio"), "alice").andExpect(status().isNotFound)
    }

    @Test
    fun `task detail points at the protected endpoint, not a storage path`() {
        call(get("/api/tasks/t-call-01"), "alice")
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.input.audioUrl").value("/api/tasks/t-call-01/audio"))
            .andExpect(jsonPath("$.input.audioName").value("call-01.wav"))
            .andExpect(jsonPath("$.input.durationMs").isNumber)
    }

    @Test
    fun `views, recording reads and denied attempts are logged before data is returned`() {
        call(get("/api/tasks/t-call-01"), "alice").andExpect(status().isOk)
        call(get("/api/tasks/t-call-01/audio"), "alice").andExpect(status().isOk)
        call(get("/api/tasks/t-call-01"), "carol").andExpect(status().isNotFound)
        call(get("/api/tasks/t-call-01/audio"), "carol").andExpect(status().isNotFound)
        call(get("/api/tasks/does-not-exist"), "alice").andExpect(status().isNotFound)

        assertEquals(
            listOf("VIEW_TASK/ALLOWED" to "alice", "READ_AUDIO/ALLOWED" to "alice", "VIEW_TASK/DENIED" to "carol", "READ_AUDIO/DENIED" to "carol"),
            logRows("t-call-01"),
        )
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM access_log WHERE task_id = 'does-not-exist'", Int::class.java))
    }

    @Test
    fun `admins see their own organisation's access log, outsiders unnamed`() {
        call(get("/api/tasks/t-call-03"), "bob").andExpect(status().isOk)
        call(get("/api/tasks/t-call-03"), "carol").andExpect(status().isNotFound)
        call(get("/api/tasks/t-b-1"), "carol").andExpect(status().isOk) // carol's own tenant: not visible to tenant-1

        call(get("/api/admin/access-log"), "alice").andExpect(status().isForbidden)
        val log = json(call(get("/api/admin/access-log"), "admin").andExpect(status().isOk))
        assertEquals(2, log.size(), log.toString())
        assertEquals("User from another organisation", log[0]["actorName"].asText())
        assertEquals("DENIED", log[0]["outcome"].asText())
        assertTrue(log[0]["actorUsername"].isNull)
        assertEquals("Bob Novak", log[1]["actorName"].asText())
        assertEquals("Affordability review: monthly income", log[1]["taskTitle"].asText())
    }
}
