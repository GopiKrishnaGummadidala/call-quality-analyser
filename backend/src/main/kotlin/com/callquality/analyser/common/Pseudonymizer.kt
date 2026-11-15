package com.callquality.analyser.common

import java.security.MessageDigest

/**
 * Demonstration of pseudonymization: replaces known (synthetic) names and phone-like numbers
 * with stable placeholders. The same input always yields the same placeholder, so references
 * stay consistent across a dataset without exposing the original value.
 *
 * This is a demo of the concept, NOT a production de-identification solution.
 */
class Pseudonymizer(names: Collection<String>) {
    private val namePattern: Regex? =
        names.filter { it.isNotBlank() }
            .sortedByDescending { it.length }
            .joinToString("|") { Regex.escape(it) }
            .takeIf { it.isNotEmpty() }
            ?.let { Regex(it, RegexOption.IGNORE_CASE) }

    private val numberPattern = Regex("""\+?\d[\d ()\-]{5,}\d""")

    fun mask(text: String): String {
        var out = numberPattern.replace(text) { m -> "[NUMBER_${tag(m.value.filter { it.isDigit() })}]" }
        val names = namePattern
        if (names != null) {
            out = names.replace(out) { m -> "[PERSON_${tag(m.value.lowercase())}]" }
        }
        return out
    }

    private fun tag(value: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray())
            .take(3)
            .joinToString("") { "%02x".format(it) }
}
