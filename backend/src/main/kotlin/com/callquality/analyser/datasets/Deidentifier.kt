package com.callquality.analyser.datasets

/**
 * Text de-identification for training releases (policy [POLICY]): removes the personal data that occurs in bank
 * call transcripts (GDPR personal data, PCI DSS card data): names, telephone numbers, e-mail addresses, URLs, dates
 * (except the bare year), IBANs, payment card numbers and long numeric identifiers (account, customer, reference
 * numbers). Amounts, rates and short numbers stay: they are what a speech model has to learn to transcribe.
 *
 * Names are already pseudonymised on ingest, but those tokens are derived from the name itself (an unsalted hash),
 * which a dictionary of candidate names can reverse. A release therefore re-keys every person token to a surrogate
 * that is local to the release (`[PERSON_1]`, `[PERSON_2]`, …): consistent inside one release, so the model still
 * sees "the same person", but never derived from the identity and never comparable across releases.
 *
 * One [Session] per release; it is not thread-safe.
 */
object Deidentifier {
    const val POLICY = "pii-text-v1"

    private const val MONTH = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|" +
        "Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"

    /** Applied in this order; earlier rules win (e.g. a URL containing digits is one URL, not an ID). */
    private val rules: List<Pair<String, Regex>> = listOf(
        "URL" to Regex("""\bhttps?://\S+|\bwww\.\S+""", RegexOption.IGNORE_CASE),
        "EMAIL" to Regex("""\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"""),
        "PERSON" to Regex("""\[PERSON_[A-Za-z0-9]+]"""),
        // Long numbers masked on ingest (phone, account or card numbers): the release cannot tell which, so NUMBER.
        "NUMBER" to Regex("""\[NUMBER_[A-Za-z0-9]+]"""),
        "IBAN" to Regex("""\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b"""),
        "CARD" to Regex("""(?<![\w\[])\d{4}(?:[ -]?\d{4}){2}[ -]?\d{1,7}\b"""),
        "DATE" to Regex(
            """\b\d{1,4}[./-]\d{1,2}[./-]\d{2,4}\b""" +
                """|\b\d{1,2}(?:st|nd|rd|th)?\s+$MONTH\b(?:\.?,?\s+\d{4})?""" +
                """|\b$MONTH\.?\s+\d{1,2}(?:st|nd|rd|th)?\b(?:,?\s+\d{4})?""" +
                """|\b$MONTH\.?\s+\d{4}\b""",
        ),
        "PHONE" to Regex("""(?<![\w\[])\+?\d[\d ()\-]{6,}\d\b"""),
        "ID" to Regex("""\b\d{5,}\b"""),
    )

    class Session {
        private val people = LinkedHashMap<String, String>()
        private val counts = sortedMapOf<String, Int>()

        /** Redactions made so far in this release, by category. */
        fun counts(): Map<String, Int> = counts.toMap()

        fun clean(text: String): String {
            var out = text
            for ((category, pattern) in rules) {
                out = pattern.replace(out) { m ->
                    counts.merge(category, 1, Int::plus)
                    if (category == "PERSON") people.getOrPut(m.value) { "[PERSON_${people.size + 1}]" } else "[$category]"
                }
            }
            return out
        }
    }
}
