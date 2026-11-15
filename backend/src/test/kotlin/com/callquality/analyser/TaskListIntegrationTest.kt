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
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.ResultActions
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
import java.time.OffsetDateTime

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class TaskListIntegrationTest {
    @Autowired lateinit var mvc: MockMvc
    @Autowired lateinit var mapper: ObjectMapper
    @Autowired lateinit var seeder: DemoDataSeeder

    @BeforeEach
    fun reset() = seeder.reset()

    private fun json(r: ResultActions): JsonNode = mapper.readTree(r.andReturn().response.contentAsString)

    private fun token(username: String): String =
        json(
            mvc.perform(
                post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                    .content(mapper.writeValueAsString(mapOf("username" to username, "password" to "Test123"))),
            ).andExpect(status().isOk),
        )["token"].asText()

    private fun call(req: MockHttpServletRequestBuilder, token: String, body: Any? = null): ResultActions {
        req.header("Authorization", "Bearer $token")
        if (body != null) req.contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(body))
        return mvc.perform(req)
    }

    private fun page(token: String, query: String = "") =
        json(call(get("/api/projects/proj-a/tasks$query"), token).andExpect(status().isOk))

    @Test
    fun `tasks come newest modification first, one page at a time, with whole-project counts`() {
        val alice = token("alice")
        val all = page(alice, "?size=100")
        val total = all["total"].asInt()
        assertEquals(total, all["projectTotal"].asInt())
        assertEquals(total, all["counts"].fields().asSequence().sumOf { it.value.asInt() })
        val times = all["items"].map { OffsetDateTime.parse(it["updatedAt"].asText()) }
        assertEquals(times.sortedDescending(), times, "most recently modified first")

        val first = page(alice, "?size=5")
        val second = page(alice, "?size=5&page=1")
        assertEquals(5, first["items"].size())
        assertEquals(listOf(0, 1), listOf(first["page"].asInt(), second["page"].asInt()))
        val ids = (first["items"] + second["items"]).map { it["id"].asText() }
        assertEquals(all["items"].take(10).map { it["id"].asText() }, ids, "pages continue where the last one ended")

        val submitted = page(alice, "?status=SUBMITTED")
        assertTrue(submitted["items"].all { it["status"].asText() == "SUBMITTED" })
        assertEquals(submitted["total"].asInt(), all["counts"]["SUBMITTED"].asInt())
        assertEquals(total, submitted["projectTotal"].asInt(), "tab counts ignore the current filter")

        val search = page(alice, "?q=ELIGIBILITY CHECK")
        assertEquals(listOf("Personal loan: eligibility check"), search["items"].map { it["title"].asText() })
        assertEquals(0, page(alice, "?q=%25")["total"].asInt(), "wildcards in the search are literal")
        assertEquals(100, page(alice, "?size=5000")["size"].asInt(), "page size is capped")
    }

    @Test
    fun `saving an edit moves the task to the top of the queue`() {
        val alice = token("alice")
        val oldest = page(alice, "?size=100&status=IN_PROGRESS")["items"].last()["id"].asText()
        val task = json(call(get("/api/tasks/$oldest"), alice).andExpect(status().isOk))
        call(put("/api/tasks/$oldest/annotation"), alice, mapOf(
            "expectedVersion" to task["annotation"]["version"].asLong(), "payload" to task["annotation"]["payload"],
        )).andExpect(status().isOk)
        assertEquals(oldest, page(alice, "?size=1")["items"][0]["id"].asText())
    }

    private operator fun JsonNode.plus(other: JsonNode): List<JsonNode> = this.toList() + other.toList()
}
