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
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.ResultActions
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status

/** Model-assisted annotation: the speech model writes a first draft, annotators correct it, approvals measure it. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ModelDraftIntegrationTest {
    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var mapper: ObjectMapper
    @Autowired lateinit var seeder: DemoDataSeeder

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

    @Test
    fun `a model-assisted task starts from the stored draft, with provenance`() {
        val task = json(call(get("/api/tasks/t-call-01"), "alice").andExpect(status().isOk))
        val draft = task["draft"]
        assertTrue(draft["modelName"].asText().startsWith("whisper-"), draft.toString())
        assertTrue(draft["provenance"].asText().contains("Real model output"))
        val segments = task["annotation"]["payload"]["segments"]
        assertEquals(draft["segments"].size(), segments.size())
        segments.forEachIndexed { i, s -> assertEquals(draft["segments"][i]["text"].asText(), s["text"].asText()) }
        assertTrue(segments.all { it["text"].asText().isNotBlank() }, "every segment has a draft to correct")
        assertEquals(0, task["annotation"]["version"].asInt(), "no human edit yet")
    }

    @Test
    fun `drafts are pseudonymised on ingest like all other text`() {
        val draft = json(call(get("/api/tasks/t-call-04"), "bob"))["draft"]
        val text = draft["segments"][0]["text"].asText()
        assertTrue(text.contains("[PERSON_") && !text.contains("Keller"), text)
    }

    @Test
    fun `corrections are measured against approved transcripts only and grow with approvals`() {
        val before = json(call(get("/api/projects/proj-a/evaluation"), "bob"))["draftCorrections"]
        assertEquals(1, before["approvedTasks"].asInt()) // t-call-04 is the only approved call in the seed
        assertTrue(before["wer"].asDouble() > 0.0 && before["wer"].asDouble() < 0.5, "real drafts need some correction")
        assertTrue(before["referenceWords"].asInt() > 30)

        call(post("/api/tasks/t-call-03/review"), "bob", mapOf("decision" to "APPROVE", "comment" to "ok")).andExpect(status().isOk)
        val after = json(call(get("/api/projects/proj-a/evaluation"), "bob"))["draftCorrections"]
        assertEquals(2, after["approvedTasks"].asInt())
        assertEquals(listOf("t-call-03", "t-call-04"), after["tasks"].map { it["taskId"].asText() })
        assertFalse(after["tasks"].any { it["segmentsEdited"].asInt() > it["segments"].asInt() })
    }

    @Test
    fun `tasks without a draft report none`() {
        val task = json(call(get("/api/tasks/t-audio-1"), "alice"))
        assertTrue(task["draft"].isNull)
    }
}
