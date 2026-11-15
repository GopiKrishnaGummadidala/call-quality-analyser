-- Portable SQL (PostgreSQL + H2 in PostgreSQL mode, used by the test suite).
-- JSON payloads are stored as TEXT and validated against a per-type JSON Schema
-- in the application layer. See docs/adr/0001-task-type-extensibility.md.

CREATE TABLE tenant (
    id   VARCHAR(64)  PRIMARY KEY,
    name VARCHAR(200) NOT NULL
);

CREATE TABLE app_user (
    id           VARCHAR(64)  PRIMARY KEY,
    tenant_id    VARCHAR(64)  NOT NULL REFERENCES tenant (id),
    display_name VARCHAR(200) NOT NULL
);

CREATE TABLE project (
    id        VARCHAR(64)  PRIMARY KEY,
    tenant_id VARCHAR(64)  NOT NULL REFERENCES tenant (id),
    name      VARCHAR(200) NOT NULL
);

CREATE TABLE project_membership (
    project_id VARCHAR(64) NOT NULL REFERENCES project (id),
    user_id    VARCHAR(64) NOT NULL REFERENCES app_user (id),
    role       VARCHAR(32) NOT NULL CHECK (role IN ('ANNOTATOR', 'REVIEWER')),
    PRIMARY KEY (project_id, user_id)
);

CREATE TABLE task (
    id             VARCHAR(64)  PRIMARY KEY,
    project_id     VARCHAR(64)  NOT NULL REFERENCES project (id),
    task_type      VARCHAR(64)  NOT NULL,
    schema_version INT          NOT NULL,
    title          VARCHAR(300) NOT NULL,
    input_json     TEXT         NOT NULL,
    status         VARCHAR(32)  NOT NULL
        CHECK (status IN ('IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'CHANGES_REQUESTED')),
    assignee_id    VARCHAR(64)  REFERENCES app_user (id),
    version        BIGINT       NOT NULL DEFAULT 0,
    created_at     TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at     TIMESTAMP WITH TIME ZONE NOT NULL
);
CREATE INDEX idx_task_project_status ON task (project_id, status);

CREATE TABLE annotation (
    id           VARCHAR(64) PRIMARY KEY,
    task_id      VARCHAR(64) NOT NULL UNIQUE REFERENCES task (id),
    payload_json TEXT        NOT NULL,
    version      BIGINT      NOT NULL,
    updated_by   VARCHAR(64) REFERENCES app_user (id),
    updated_at   TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE review (
    id           VARCHAR(64) PRIMARY KEY,
    task_id      VARCHAR(64) NOT NULL REFERENCES task (id),
    reviewer_id  VARCHAR(64) NOT NULL REFERENCES app_user (id),
    decision     VARCHAR(32) NOT NULL CHECK (decision IN ('APPROVE', 'REQUEST_CHANGES')),
    comment_text TEXT,
    created_at   TIMESTAMP WITH TIME ZONE NOT NULL
);
CREATE INDEX idx_review_task ON review (task_id);

CREATE TABLE audit_event (
    seq           BIGINT GENERATED ALWAYS AS IDENTITY,
    id            VARCHAR(64) PRIMARY KEY,
    project_id    VARCHAR(64) NOT NULL REFERENCES project (id),
    entity_type   VARCHAR(64) NOT NULL,
    entity_id     VARCHAR(64) NOT NULL,
    actor_id      VARCHAR(64) NOT NULL REFERENCES app_user (id),
    action        VARCHAR(64) NOT NULL,
    metadata_json TEXT        NOT NULL,
    created_at    TIMESTAMP WITH TIME ZONE NOT NULL
);
CREATE INDEX idx_audit_entity ON audit_event (entity_type, entity_id);

CREATE TABLE model_run (
    id                 VARCHAR(64)  PRIMARY KEY,
    project_id         VARCHAR(64)  NOT NULL REFERENCES project (id),
    task_type          VARCHAR(64)  NOT NULL,
    model_name         VARCHAR(200) NOT NULL,
    model_version      VARCHAR(64)  NOT NULL,
    output_fixture_key VARCHAR(300) NOT NULL
);
