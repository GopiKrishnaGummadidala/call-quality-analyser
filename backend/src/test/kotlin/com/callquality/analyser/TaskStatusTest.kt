package com.callquality.analyser

import com.callquality.analyser.tasks.TaskStatus
import com.callquality.analyser.tasks.TaskStatus.APPROVED
import com.callquality.analyser.tasks.TaskStatus.CHANGES_REQUESTED
import com.callquality.analyser.tasks.TaskStatus.IN_PROGRESS
import com.callquality.analyser.tasks.TaskStatus.SUBMITTED
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class TaskStatusTest {
    @Test
    fun `allowed transitions are exactly the documented ones`() {
        val allowed = setOf(
            IN_PROGRESS to SUBMITTED,
            SUBMITTED to APPROVED,
            SUBMITTED to CHANGES_REQUESTED,
            CHANGES_REQUESTED to SUBMITTED,
        )
        for (from in TaskStatus.entries) for (to in TaskStatus.entries) {
            assertEquals((from to to) in allowed, from.canTransitionTo(to), "$from -> $to")
        }
    }
}
