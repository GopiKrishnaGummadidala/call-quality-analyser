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
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class UserManagementIntegrationTest {
    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var mapper: ObjectMapper
    @Autowired lateinit var seeder: DemoDataSeeder
    @Autowired lateinit var jdbc: JdbcTemplate

    @BeforeEach
    fun reset() = seeder.reset()

    private fun login(username: String, password: String = "Test123"): ResultActions =
        mvc.perform(
            post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(mapOf("username" to username, "password" to password))),
        )

    private fun token(username: String, password: String = "Test123") =
        json(login(username, password).andExpect(status().isOk))["token"].asText()

    private fun json(r: ResultActions): JsonNode = mapper.readTree(r.andReturn().response.contentAsString)

    private fun call(req: MockHttpServletRequestBuilder, token: String, body: Any? = null): ResultActions {
        req.header("Authorization", "Bearer $token")
        if (body != null) req.contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(body))
        return mvc.perform(req)
    }

    private fun newUser(vararg extra: Pair<String, Any?>) = mapOf(
        "username" to "frank", "displayName" to "Frank Weber", "password" to "Welcome1", "globalRole" to "USER",
        "memberships" to listOf(mapOf("projectId" to "proj-a", "role" to "ANNOTATOR")),
    ) + extra

    @Test
    fun `an admin creates a user who can sign in and sees exactly the projects given`() {
        val admin = token("admin")
        val created = json(call(post("/api/admin/users"), admin, newUser()).andExpect(status().isCreated))
        assertEquals("frank", created["username"].asText())
        assertEquals("proj-a", created["memberships"][0]["projectId"].asText())

        val listed = json(call(get("/api/admin/users"), admin).andExpect(status().isOk))
        assertEquals("frank", listed[0]["username"].asText(), "the newest account is listed first")

        val frank = token("frank", "Welcome1")
        val projects = json(call(get("/api/me/projects"), frank).andExpect(status().isOk))
        assertEquals(listOf("proj-a"), projects.map { it["id"].asText() })
        assertEquals("ANNOTATOR", projects[0]["role"].asText())

        val hash = jdbc.queryForObject("SELECT password_hash FROM app_user WHERE username = 'frank'", String::class.java)!!
        assertTrue(hash.startsWith("{bcrypt}"))
        val events = json(call(get("/api/admin/account-events"), admin).andExpect(status().isOk))
        assertEquals("USER_CREATED", events[0]["action"].asText())
        assertEquals("Dana Fischer", events[0]["actorName"].asText())
        assertFalse(events.toString().contains("Welcome1"), "the password never reaches the audit trail")
    }

    @Test
    fun `invalid accounts are rejected with every reason, and usernames are unique`() {
        val admin = token("admin")
        val bad = json(call(post("/api/admin/users"), admin, mapOf(
            "username" to "A!", "displayName" to " ", "password" to "short", "globalRole" to "OPERATOR",
            "memberships" to listOf(mapOf("projectId" to "proj-b", "role" to "ANNOTATOR")),
        )).andExpect(status().isUnprocessableEntity))
        val violations = bad["violations"].map { it.asText() }
        assertEquals(5, violations.size, violations.toString())
        assertTrue(violations.contains("Unknown project"), "a project of another organisation is not revealed")

        call(post("/api/admin/users"), admin, newUser("globalRole" to "ADMIN")).andExpect(status().isUnprocessableEntity)
            .andExpect(jsonPath("$.violations[0]").value("Admins administer the organisation and hold no project roles"))
        call(post("/api/admin/users"), admin, newUser("username" to "Alice")).andExpect(status().isConflict)
            .andExpect(jsonPath("$.code").value("USERNAME_TAKEN"))
    }

    @Test
    fun `editing project roles takes effect on the user's next request`() {
        val admin = token("admin")
        val alice = token("alice")
        call(put("/api/admin/users/u-alice"), admin, mapOf(
            "displayName" to "Alice Becker-Roth",
            "memberships" to listOf(mapOf("projectId" to "proj-c", "role" to "ANNOTATOR")),
        )).andExpect(status().isOk).andExpect(jsonPath("$.displayName").value("Alice Becker-Roth"))

        val projects = json(call(get("/api/me/projects"), alice).andExpect(status().isOk))
        assertEquals(listOf("proj-c" to "ANNOTATOR"), projects.map { it["id"].asText() to it["role"].asText() })
        call(get("/api/projects/proj-a/tasks"), alice).andExpect(status().isNotFound)

        val event = json(call(get("/api/admin/account-events"), admin))[0]
        assertEquals("USER_UPDATED", event["action"].asText())
        assertEquals(setOf("displayName", "memberships"), event["details"].fieldNames().asSequence().toSet())
    }

    @Test
    fun `a password reset or a new account role ends the user's open sessions`() {
        val admin = token("admin")
        val bob = token("bob")
        val erik = token("erik")
        Thread.sleep(1100) // token issued-at has one-second resolution: these sessions predate the changes below
        call(put("/api/admin/users/u-bob"), admin, mapOf("password" to "NewPass9")).andExpect(status().isOk)
        call(get("/api/me/projects"), bob).andExpect(status().isUnauthorized)
        login("bob").andExpect(status().isUnauthorized)
        val fresh = token("bob", "NewPass9")
        call(get("/api/me/projects"), fresh).andExpect(status().isOk)

        call(put("/api/admin/users/u-erik"), admin, mapOf("globalRole" to "ADMIN", "memberships" to emptyList<Any>()))
            .andExpect(status().isOk)
        call(get("/api/me/projects"), erik).andExpect(status().isUnauthorized)
        val erikAdmin = token("erik")
        call(get("/api/admin/users"), erikAdmin).andExpect(status().isOk)

        val actions = json(call(get("/api/admin/account-events"), admin)).map { it["action"].asText() }
        assertTrue(actions.containsAll(listOf("PASSWORD_RESET", "USER_UPDATED")))
    }

    @Test
    fun `admins cannot lock themselves out, reach other organisations, and users cannot manage accounts`() {
        val admin = token("admin")
        call(put("/api/admin/users/u-dana"), admin, mapOf("globalRole" to "USER")).andExpect(status().isUnprocessableEntity)
            .andExpect(jsonPath("$.violations[0]").value("You cannot remove your own admin role"))
        call(put("/api/admin/users/u-carol"), admin, mapOf("displayName" to "x")).andExpect(status().isNotFound)
        call(put("/api/admin/users/u-ops"), admin, mapOf("displayName" to "x")).andExpect(status().isNotFound)

        val alice = token("alice")
        call(post("/api/admin/users"), alice, newUser()).andExpect(status().isForbidden)
        call(put("/api/admin/users/u-bob"), alice, mapOf("displayName" to "x")).andExpect(status().isForbidden)
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM account_event", Int::class.java))
    }
}
