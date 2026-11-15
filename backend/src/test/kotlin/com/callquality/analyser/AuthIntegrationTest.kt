package com.callquality.analyser

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.callquality.analyser.demo.DemoDataSeeder
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
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
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AuthIntegrationTest {
    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var mapper: ObjectMapper
    @Autowired lateinit var seeder: DemoDataSeeder
    @Autowired lateinit var jdbc: JdbcTemplate

    @BeforeEach
    fun reset() = seeder.reset()

    private fun login(username: String?, password: String?): ResultActions =
        mvc.perform(
            post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(mapOf("username" to username, "password" to password))),
        )

    private fun json(r: ResultActions): JsonNode = mapper.readTree(r.andReturn().response.contentAsString)
    private fun tokenFor(username: String) = json(login(username, "Test123").andExpect(status().isOk))["token"].asText()
    private fun bearer(token: String) = "Bearer $token"

    @Test
    fun `every demo account signs in with the demo password and gets its account role`() {
        for ((username, role) in listOf("alice" to "USER", "bob" to "USER", "carol" to "USER", "erik" to "USER", "admin" to "ADMIN", "ops" to "OPERATOR")) {
            login(username, "Test123").andExpect(status().isOk)
                .andExpect(jsonPath("$.token").isNotEmpty)
                .andExpect(jsonPath("$.expiresAt").isNotEmpty)
                .andExpect(jsonPath("$.user.username").value(username))
                .andExpect(jsonPath("$.user.globalRole").value(role))
        }
        // usernames are case-insensitive and trimmed
        login("  Alice ", "Test123").andExpect(status().isOk)
    }

    @Test
    fun `passwords are stored only as bcrypt hashes`() {
        val hashes = jdbc.queryForList("SELECT password_hash FROM app_user", String::class.java)
        assertEquals(6, hashes.size)
        assertTrue(hashes.all { it.startsWith("{bcrypt}") })
        assertFalse(hashes.any { it.contains("Test123") })
    }

    @Test
    fun `wrong password and unknown user fail the same way`() {
        val wrong = json(login("alice", "wrong").andExpect(status().isUnauthorized))
        val unknown = json(login("nobody", "Test123").andExpect(status().isUnauthorized))
        assertEquals(wrong, unknown)
        assertEquals("Invalid username or password", wrong["message"].asText())
        login("alice", "test123").andExpect(status().isUnauthorized) // passwords are case-sensitive
        login("alice", "").andExpect(status().isUnauthorized)
        login(null, null).andExpect(status().isUnauthorized)
    }

    @Test
    fun `token identifies the caller and tampered tokens are rejected`() {
        val token = tokenFor("bob")
        mvc.perform(get("/api/auth/me").header("Authorization", bearer(token)))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.id").value("u-bob"))
            .andExpect(jsonPath("$.tenantName").value("Northbridge Bank (demo)"))
        val (header, payload, signature) = token.split(".")
        val forged = "$header.$payload.${signature.reversed()}"
        mvc.perform(get("/api/auth/me").header("Authorization", bearer(forged)))
            .andExpect(status().isUnauthorized)
            .andExpect(jsonPath("$.code").value("UNAUTHORIZED"))
    }

    @Test
    fun `project roles still come from memberships, not from the token`() {
        mvc.perform(get("/api/me/projects").header("Authorization", bearer(tokenFor("bob"))))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$[0].role").value("REVIEWER"))
        // the admin account has no project membership, so it sees no projects or tasks
        val admin = tokenFor("admin")
        mvc.perform(get("/api/me/projects").header("Authorization", bearer(admin))).andExpect(jsonPath("$.length()").value(0))
        mvc.perform(get("/api/tasks/t-audio-1").header("Authorization", bearer(admin))).andExpect(status().isNotFound)
    }

    @Test
    fun `administration endpoints require the ADMIN role`() {
        val alice = tokenFor("alice")
        mvc.perform(get("/api/admin/users").header("Authorization", bearer(alice)))
            .andExpect(status().isForbidden).andExpect(jsonPath("$.code").value("FORBIDDEN"))
        mvc.perform(post("/api/demo/reset").header("Authorization", bearer(alice))).andExpect(status().isForbidden)
        mvc.perform(post("/api/demo/reset")).andExpect(status().isUnauthorized)

        val admin = tokenFor("admin")
        val users = json(mvc.perform(get("/api/admin/users").header("Authorization", bearer(admin))).andExpect(status().isOk))
        // limited to the admin's own tenant: Carol (other tenant) is not listed
        assertEquals(listOf("alice", "bob", "admin", "erik"), users.map { it["username"].asText() })
        assertEquals("REVIEWER", users[1]["memberships"][0]["role"].asText())
        // the reset re-seeds every tenant, so even a tenant admin may not run it
        mvc.perform(post("/api/demo/reset").header("Authorization", bearer(admin))).andExpect(status().isForbidden)
    }
}
