package com.callquality.analyser

import com.callquality.analyser.datasets.Deidentifier
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class DeidentifierTest {

    @Test
    fun `removes the personal data that occurs in bank call transcripts`() {
        val s = Deidentifier.Session()
        val out = s.clean(
            "Opened on 12.03.2024, payment due March 14, 2024. Call +49 30 1234567 or mail anna.berger@example.org, " +
                "IBAN DE89 3704 0044 0532 0130 00, card 4111 1111 1111 1111, customer 4471209, see https://bank.example.org/c/42.",
        )
        assertEquals(
            "Opened on [DATE], payment due [DATE]. Call [PHONE] or mail [EMAIL], " +
                "IBAN [IBAN], card [CARD], customer [ID], see [URL]",
            out,
        )
        assertEquals(mapOf("CARD" to 1, "DATE" to 2, "EMAIL" to 1, "IBAN" to 1, "ID" to 1, "PHONE" to 1, "URL" to 1), s.counts())
    }

    @Test
    fun `person tokens are re-keyed to release-local surrogates, consistently within a release`() {
        val s = Deidentifier.Session()
        assertEquals("[PERSON_1] met [PERSON_2]", s.clean("[PERSON_3fa2c1] met [PERSON_9b10d4]"))
        assertEquals("[PERSON_2] called [PERSON_1] back", s.clean("[PERSON_9b10d4] called [PERSON_3fa2c1] back"))
        // a new release starts over, so surrogates cannot be linked across releases
        assertEquals("[PERSON_1]", Deidentifier.Session().clean("[PERSON_9b10d4]"))
    }

    @Test
    fun `ingest number tokens become NUMBER and amounts and rates stay`() {
        val s = Deidentifier.Session()
        assertEquals("Call [NUMBER] after lunch.", s.clean("Call [NUMBER_ab12cd] after lunch."))
        val terms = "Borrow 15,000 euros over 5 years at 6.9%, fee 1% (about 150 euros), account ending 4417, due in May."
        assertEquals(terms, s.clean(terms)) // amounts, rates, the last 4 digits and a bare month are not identifiers
    }
}
