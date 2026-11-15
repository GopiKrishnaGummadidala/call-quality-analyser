package com.callquality.analyser.evaluation

data class WerResult(
    val substitutions: Int,
    val deletions: Int,
    val insertions: Int,
    val referenceWords: Int,
) {
    val errors: Int get() = substitutions + deletions + insertions
    val wer: Double get() = errors.toDouble() / referenceWords
}

/**
 * Word error rate = (S + D + I) / N where N is the number of reference words.
 * Normalization (documented in the UI): lower-case, punctuation removed, whitespace-tokenized.
 */
object WerCalculator {
    private val punctuation = Regex("[^\\p{L}\\p{N}\\s']")
    private val whitespace = Regex("\\s+")

    fun tokenize(text: String): List<String> =
        text.lowercase().replace(punctuation, " ").trim().split(whitespace).filter { it.isNotEmpty() }

    fun compute(reference: String, hypothesis: String): WerResult {
        val ref = tokenize(reference)
        val hyp = tokenize(hypothesis)
        require(ref.isNotEmpty()) { "Reference must contain at least one word" }

        val d = Array(ref.size + 1) { IntArray(hyp.size + 1) }
        for (i in 0..ref.size) d[i][0] = i
        for (j in 0..hyp.size) d[0][j] = j
        for (i in 1..ref.size) {
            for (j in 1..hyp.size) {
                val sub = d[i - 1][j - 1] + if (ref[i - 1] == hyp[j - 1]) 0 else 1
                d[i][j] = minOf(sub, d[i - 1][j] + 1, d[i][j - 1] + 1)
            }
        }

        var i = ref.size
        var j = hyp.size
        var s = 0
        var del = 0
        var ins = 0
        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && d[i][j] == d[i - 1][j - 1] + (if (ref[i - 1] == hyp[j - 1]) 0 else 1)) {
                if (ref[i - 1] != hyp[j - 1]) s++
                i--
                j--
            } else if (i > 0 && d[i][j] == d[i - 1][j] + 1) {
                del++
                i--
            } else {
                ins++
                j--
            }
        }
        return WerResult(s, del, ins, ref.size)
    }
}
