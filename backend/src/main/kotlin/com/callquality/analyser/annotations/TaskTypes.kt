package com.callquality.analyser.annotations

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.networknt.schema.JsonSchema
import com.networknt.schema.JsonSchemaFactory
import com.networknt.schema.SpecVersion
import org.springframework.core.io.ClassPathResource
import org.springframework.stereotype.Component

/**
 * One implementation per (taskType, schemaVersion). Adding a task type = a JSON Schema resource
 * + one class implementing this interface (+ one entry in the frontend editor registry).
 * Structural validation is done by the JSON Schema; this interface adds the rules a schema cannot express.
 */
interface TaskTypeDefinition {
    val taskType: String
    val schemaVersion: Int
    val schemaResource: String

    /** Rules applied to every save (drafts may be incomplete). */
    fun validateForSave(payload: JsonNode): List<String>

    /** Additional completeness rules applied on submit. */
    fun validateForSubmit(payload: JsonNode): List<String>
}

@Component
class TranscriptionTaskType : TaskTypeDefinition {
    override val taskType = "TRANSCRIPTION"
    override val schemaVersion = 1
    override val schemaResource = "schemas/transcription-v1.json"

    override fun validateForSave(payload: JsonNode): List<String> {
        val errors = mutableListOf<String>()
        val seenIds = HashSet<String>()
        for ((index, segment) in payload.path("segments").withIndex()) {
            val n = index + 1
            val start = segment.path("startMs").asLong()
            val end = segment.path("endMs").asLong()
            if (end <= start) errors += "Segment $n: end time must be after start time"
            if (!seenIds.add(segment.path("id").asText())) errors += "Segment $n: duplicate segment id"
            // Overlapping segments are intentionally ALLOWED: real recordings contain overlapping speech
            // (e.g. customer and agent talking at once). Annotators mark these with label CROSSTALK.
        }
        return errors
    }

    override fun validateForSubmit(payload: JsonNode): List<String> {
        val errors = mutableListOf<String>()
        val segments = payload.path("segments")
        if (segments.size() == 0) errors += "Add at least one segment before submitting"
        for ((index, segment) in segments.withIndex()) {
            if (segment.path("text").asText().isBlank()) errors += "Segment ${index + 1}: transcript text is required"
        }
        return errors
    }
}

/**
 * Quality review of a recorded bank call: each check on the agent's conduct is PASS, FAIL or NOT_APPLICABLE, plus an
 * overall outcome. The checks follow common consumer-credit conduct rules (identify the customer before disclosing
 * anything, assess affordability, disclose costs and withdrawal rights, no pressure selling).
 */
@Component
class CallScorecardTaskType : TaskTypeDefinition {
    override val taskType = "CALL_SCORECARD"
    override val schemaVersion = 1
    override val schemaResource = "schemas/call-scorecard-v1.json"

    override fun validateForSave(payload: JsonNode): List<String> = emptyList()

    override fun validateForSubmit(payload: JsonNode): List<String> {
        val errors = mutableListOf<String>()
        val checks = payload.path("checks")
        val results = CHECKS.associateWith { checks.path(it).takeIf { n -> n.isTextual }?.asText() }
        val missing = results.filterValues { it == null }.keys
        if (missing.isNotEmpty()) errors += "Answer every check (${missing.size} still open)"
        val outcome = payload.path("outcome").takeIf { it.isTextual }?.asText()
        if (outcome == null) errors += "Choose an overall outcome"
        val failed = results.filterValues { it == "FAIL" }.keys
        if (failed.isNotEmpty() && payload.path("notes").asText().isBlank()) errors += "Notes are required when a check fails"
        if (failed.isNotEmpty() && outcome == "COMPLIANT") errors += "A call with a failed check cannot be compliant"
        return errors
    }

    companion object {
        val CHECKS = listOf(
            "IDENTITY_VERIFIED", "PURPOSE_STATED", "AFFORDABILITY_CHECKED", "COSTS_DISCLOSED",
            "WITHDRAWAL_RIGHTS_EXPLAINED", "NO_PRESSURE_SELLING", "NEXT_STEPS_CONFIRMED",
        )
    }
}

@Component
class TaskTypeRegistry(definitions: List<TaskTypeDefinition>, private val mapper: ObjectMapper) {
    private val byKey: Map<Pair<String, Int>, TaskTypeDefinition> =
        definitions.associateBy { it.taskType to it.schemaVersion }
    private val schemaNodes = HashMap<Pair<String, Int>, JsonNode>()
    private val compiled = HashMap<Pair<String, Int>, JsonSchema>()
    private val factory = JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V7)

    init {
        for ((key, def) in byKey) {
            val node = ClassPathResource(def.schemaResource).inputStream.use { mapper.readTree(it) }
            schemaNodes[key] = node
            compiled[key] = factory.getSchema(node)
        }
    }

    private fun definition(type: String, version: Int): TaskTypeDefinition =
        byKey[type to version] ?: throw IllegalStateException("Unsupported task type $type v$version")

    fun schemaJson(type: String, version: Int): JsonNode {
        definition(type, version)
        return schemaNodes.getValue(type to version)
    }

    /** Returns user-facing violations; empty list means valid. */
    fun validateForSave(type: String, version: Int, payload: JsonNode): List<String> {
        val def = definition(type, version)
        val structural = compiled.getValue(type to version).validate(payload).map { it.message }.sorted()
        if (structural.isNotEmpty()) return structural
        return def.validateForSave(payload)
    }

    fun validateForSubmit(type: String, version: Int, payload: JsonNode): List<String> {
        val base = validateForSave(type, version, payload)
        if (base.isNotEmpty()) return base
        return definition(type, version).validateForSubmit(payload)
    }
}
