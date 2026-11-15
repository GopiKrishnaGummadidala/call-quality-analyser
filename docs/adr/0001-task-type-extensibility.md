# ADR 0001: Task-type extensibility via schema + registry

**Status:** accepted

**Context.** Call QA covers several task kinds (transcription, QA scorecards, later intent or complaint tagging, ...).
A generic workflow engine is out of scope; copy-pasting the app per type is not acceptable.

**Decision.** Every task carries `task_type` and `schema_version`. The backend has a `TaskTypeDefinition` per
(type, version) with a JSON Schema (structure) and code (rules a schema cannot express, e.g. end > start).
The frontend has an editor registry keyed the same way. Lifecycle (autosave, submit, review, audit,
authorization) is type-agnostic.

**Consequences.** Adding a type = one schema + one backend class + one registry entry. Old payloads stay valid
because versions are explicit. Payloads are `TEXT` JSON validated in the application layer; a production
PostgreSQL deployment could switch to `JSONB` (indexing/querying) without API changes.
