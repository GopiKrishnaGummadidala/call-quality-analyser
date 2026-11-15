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
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.security.MessageDigest

/** Approved annotations -> versioned, de-identified, immutable training release (docs/data-flow.md). */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class DatasetIntegrationTest {
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
    private fun call(b: MockHttpServletRequestBuilder, u: String, body: Any? = null): ResultActions {
        b.header("Authorization", "Bearer ${token(u)}")
        if (body != null) b.contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(body))
        return mvc.perform(b)
    }
    private fun release(project: String = "proj-a") = json(call(post("/api/admin/projects/$project/datasets"), "admin").andExpect(status().isCreated))
    private fun manifestLines(releaseId: String): Pair<List<JsonNode>, String> {
        val res = call(get("/api/admin/datasets/$releaseId/manifest.jsonl"), "admin").andExpect(status().isOk).andReturn().response
        val body = res.contentAsByteArray
        val sha = MessageDigest.getInstance("SHA-256").digest(body).joinToString("") { "%02x".format(it) }
        assertEquals(res.getHeader("X-Manifest-SHA256"), sha, "header matches the bytes")
        return String(body).trim().lines().map { mapper.readTree(it) } to sha
    }

    @Test
    fun `only approved annotations are released, with lineage, splits and checksums`() {
        val r = release()
        assertEquals(1, r["version"].asInt())
        assertEquals(2, r["itemCount"].asInt()) // t-call-04 (transcription) + t-score-03 (QA scorecard)
        assertEquals("pii-text-v1", r["deidPolicy"].asText())

        val (lines, sha) = manifestLines(r["id"].asText())
        assertEquals(r["manifestSha256"].asText(), sha)
        assertEquals(listOf("t-call-04", "t-score-03"), lines.map { it["source"]["task_id"].asText() })
        val audio = lines[0]["audio"]
        assertEquals("call-04.wav", audio["file"].asText())
        assertEquals(64, audio["sha256"].asText().length)
        assertTrue(audio["contains_identifiers"].asBoolean())
        assertTrue(lines.all { it["split"].asText() in setOf("train", "val", "test") })
        assertEquals(3L, lines[0]["source"]["annotation_version"].asLong())
    }

    @Test
    fun `released text is de-identified and person tokens are release-local`() {
        val (lines, _) = manifestLines(release()["id"].asText())
        val text = lines.toString()
        assertFalse(text.contains("Keller"), "no names")
        assertFalse(Regex("""\[PERSON_[0-9a-f]{6}]""").containsMatchIn(text), "no hash-derived ingest tokens")
        assertTrue(text.contains("[PERSON_1]"))
        // "Max Keller" and "Mister Keller" in the approved call and again in its approved scorecard; a second release counts its own
        assertEquals(4, release()["redactions"]["PERSON"].asInt())
    }

    @Test
    fun `releases are immutable snapshots with stable splits`() {
        val v1 = release()
        val (v1Lines, v1Sha) = manifestLines(v1["id"].asText())

        // a reviewer approves another submission; the next release grows, the old one does not change
        call(post("/api/tasks/t-call-03/review"), "bob", mapOf("decision" to "APPROVE", "comment" to "ok")).andExpect(status().isOk)
        val v2 = release()
        assertEquals(2, v2["version"].asInt())
        assertEquals(3, v2["itemCount"].asInt())
        assertEquals(v1Sha, manifestLines(v1["id"].asText()).second)

        val v2Splits = manifestLines(v2["id"].asText()).first.associate { it["source"]["task_id"].asText() to it["split"].asText() }
        v1Lines.forEach { assertEquals(it["split"].asText(), v2Splits[it["source"]["task_id"].asText()], "split is stable") }
    }

    @Test
    fun `releasing and exporting are admin-only, tenant-scoped and audited`() {
        call(post("/api/admin/projects/proj-a/datasets"), "bob").andExpect(status().isForbidden)
        call(post("/api/admin/projects/proj-b/datasets"), "admin").andExpect(status().isNotFound) // other organisation

        val r = release()
        call(get("/api/admin/datasets/${r["id"].asText()}/manifest.jsonl"), "alice").andExpect(status().isForbidden)
        manifestLines(r["id"].asText())
        val actions = jdbc.queryForList(
            "SELECT action FROM audit_event WHERE entity_type = 'DATASET' AND entity_id = ? ORDER BY seq", String::class.java, r["id"].asText(),
        )
        assertEquals(listOf("DATASET_RELEASED", "DATASET_EXPORTED"), actions)
        call(get("/api/admin/datasets/${r["id"].asText()}"), "admin")
            .andExpect(jsonPath("$.release.downloads").value(1))
            .andExpect(jsonPath("$.preview.length()").value(2))
    }

    @Test
    fun `nothing to release is reported, not an empty release`() {
        // the other-org admin does not exist in the seed; use a project in this tenant with no approvals instead
        jdbc.update("UPDATE task SET status = 'SUBMITTED' WHERE project_id = 'proj-c' AND status = 'APPROVED'")
        call(post("/api/admin/projects/proj-c/datasets"), "admin")
            .andExpect(status().isUnprocessableEntity)
            .andExpect(jsonPath("$.violations[0]").value("There are no approved annotations to release yet"))
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM dataset_release", Int::class.java))
    }
}
