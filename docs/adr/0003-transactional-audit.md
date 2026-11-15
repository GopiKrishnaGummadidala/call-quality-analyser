# ADR 0003: Audit events are written in the same transaction

**Status:** accepted

**Decision.** Each service method that changes workflow state (`submit`, `review`) runs in one
`@Transactional` unit that performs the state change, inserts any `review` row, and inserts the `audit_event`.
If any step fails, everything rolls back; there can be no transition without an audit record and no orphan audit record.
Audit rows contain ids, action and from/to status — never transcript text. Autosaves are not audited (too noisy);
the annotation's `version`/`updated_by`/`updated_at` carry that provenance.

**Alternatives.** Outbox/event bus (more moving parts, needed only when audit leaves the database);
idempotency keys (add only if retry semantics require them: a retried submit already fails with 409 because the
task is no longer in an editable state).

**Verified by.** `WorkflowIntegrationTest.audit event and transition roll back together when the audit write fails`.
