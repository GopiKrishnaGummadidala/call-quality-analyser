package com.callquality.analyser

import com.callquality.analyser.evaluation.WerCalculator
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class WerCalculatorTest {
    @Test
    fun `identical text has zero errors`() {
        val r = WerCalculator.compute("the cat sat", "The cat, sat!")
        assertEquals(0, r.errors)
        assertEquals(0.0, r.wer)
    }

    @Test
    fun `counts substitution deletion and insertion`() {
        val r = WerCalculator.compute("the cat sat on the mat", "the dog sat the mat now")
        assertEquals(1, r.substitutions) // cat -> dog
        assertEquals(1, r.deletions)     // "on"
        assertEquals(1, r.insertions)    // "now"
        assertEquals(6, r.referenceWords)
        assertEquals(0.5, r.wer)
    }

    @Test
    fun `empty reference is rejected`() {
        assertThrows(IllegalArgumentException::class.java) { WerCalculator.compute("  ", "hello") }
    }
}
