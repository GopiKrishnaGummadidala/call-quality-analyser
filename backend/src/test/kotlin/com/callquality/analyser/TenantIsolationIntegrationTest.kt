package com.callquality.analyser

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.callquality.analyser.demo.DemoDataSeeder
import org.junit.jupiter.api.Assertions.assertEquals
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
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status

/** Tenant administration and platform operation are separate: neither can reach into the other's scope. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class TenantIsolationIntegrationTest {
    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var mapper: ObjectMapper
    @Autowired lateinit var seeder: DemoDataSeeder
    @Autowired lateinit var jdbc: JdbcTemplate

    private val tokens = mutableMapOf<String, String>()

    @BeforeEach
    fun reset() = seeder.reset()

    private fun json(r: ResultActions): JsonNode = mapper.readTree(r.andReturn().response.contentAsString)
    private fun token(u: String) = tokens.getOrPut(u) {
        val body = mapper.writeValueAsString(mapOf("username" to u, "password" to "Test123"))
        json(mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isOk))["token"].asText()
    }
    private fun call(b: MockHttpServletRequestBuilder, u: String) = mvc.perform(b.header("Authorization", "Bearer ${token(u)}"))

    @Test
    fun `only the platform operator may reset, and a reset restores every tenant`() {
        for (user in listOf("alice", "bob", "carol", "erik", "admin")) {
            call(post("/api/demo/reset"), user).andExpect(status().isForbidden)
        }
        jdbc.update("UPDATE task SET title = 'changed' WHERE id IN ('t-call-01', 't-b-1')")
        call(post("/api/demo/reset"), "ops").andExpect(status().isNoContent)
        assertEquals(
            listOf("Other tenant task", "Personal loan: eligibility check"),
            jdbc.queryForList("SELECT title FROM task WHERE id IN ('t-call-01', 't-b-1') ORDER BY id", String::class.java).sorted(),
        )
    }

    @Test
    fun `the operator sees tenant sizes but no tenant content`() {
        val tenants = json(call(get("/api/platform/tenants"), "ops").andExpect(status().isOk))
        val byName = tenants.associateBy { it["name"].asText() }
        assertEquals(setOf("Northbridge Bank (demo)", "Other Bank", "Platform operator"), byName.keys)
        assertEquals(4, byName.getValue("Northbridge Bank (demo)")["users"].asInt())
        assertEquals(1, byName.getValue("Other Bank")["tasks"].asInt())
        assertEquals(0, byName.getValue("Platform operator")["projects"].asInt())

        // no tenant-scoped data for the operator: not a member of any project, not a tenant admin
        call(get("/api/me/projects"), "ops").andExpect(status().isOk).andExpect { assertEquals("[]", it.response.contentAsString) }
        call(get("/api/tasks/t-call-01"), "ops").andExpect(status().isNotFound)
        call(get("/api/tasks/t-call-01/audio"), "ops").andExpect(status().isNotFound)
        call(get("/api/admin/users"), "ops").andExpect(status().isForbidden)
        call(get("/api/admin/access-log"), "ops").andExpect(status().isForbidden)
        call(post("/api/admin/projects/proj-a/datasets"), "ops").andExpect(status().isForbidden)
    }

    @Test
    fun `tenant admins cannot use platform endpoints`() {
        call(get("/api/platform/tenants"), "admin").andExpect(status().isForbidden)
        call(get("/api/platform/tenants"), "alice").andExpect(status().isForbidden)
    }
}
