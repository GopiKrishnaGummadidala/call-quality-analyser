# ADR 0002: Optimistic concurrency with a per-task lock

**Status:** accepted

**Context.** One assignee per task, but multiple tabs, autosave racing submit, and reviewers acting on stale editors are real.

**Decision.**
- `annotation.version` is the concurrency token. Save and submit send `expectedVersion`; the update is
  `... WHERE task_id = ? AND version = ?`. Zero rows => HTTP 409 `STALE_VERSION`. The UI stops autosaving and
  offers reload / copy-my-edits instead of overwriting.
- `task.version` is bumped on every status transition and status changes are compare-and-set on the old status.
- Save, submit and review first `SELECT ... FOR UPDATE` the task row (after authorization), then re-read it.
  This serializes them, so a save cannot slip in after a submit commits.
- Invalid state transitions return 409 `INVALID_TRANSITION`; edits to non-editable tasks return 409 `INVALID_STATE`.

**Consequences.** No silent overwrites, simple to reason about, no long-lived locks. Simultaneous multi-annotator
editing is explicitly unsupported (would need merge/CRDT).
