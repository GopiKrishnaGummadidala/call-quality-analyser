package com.callquality.analyser

import com.callquality.analyser.common.Pseudonymizer
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class PseudonymizerTest {
    private val p = Pseudonymizer(listOf("Anna Berger"))

    @Test
    fun `masks names and phone numbers`() {
        val out = p.mask("Call Anna Berger on +49 30 1234567 today")
        assertFalse(out.contains("Anna"))
        assertFalse(out.contains("1234567"))
        assertTrue(out.contains("[PERSON_"))
        assertTrue(out.contains("[NUMBER_"))
    }

    @Test
    fun `placeholders are stable`() {
        assertEquals(p.mask("anna berger"), p.mask("ANNA BERGER"))
        assertEquals(p.mask("Anna Berger"), Pseudonymizer(listOf("Anna Berger")).mask("Anna Berger"))
    }
}
