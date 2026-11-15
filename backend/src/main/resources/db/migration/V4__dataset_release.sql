-- Versioned, de-identified training-data releases built from APPROVED annotations (see docs/data-flow.md).
-- A release is immutable: its records are stored as the exact manifest lines that were hashed and exported.

CREATE TABLE dataset_release (
    id              VARCHAR(64)  PRIMARY KEY,
    project_id      VARCHAR(64)  NOT NULL REFERENCES project (id),
    version         INT          NOT NULL,
    created_by      VARCHAR(64)  NOT NULL REFERENCES app_user (id),
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL,
    deid_policy     VARCHAR(64)  NOT NULL,
    item_count      INT          NOT NULL,
    audio_ms        BIGINT       NOT NULL,
    split_train     INT          NOT NULL,
    split_val       INT          NOT NULL,
    split_test      INT          NOT NULL,
    redactions_json TEXT         NOT NULL,
    manifest_sha256 VARCHAR(64)  NOT NULL,
    CONSTRAINT ux_dataset_release_version UNIQUE (project_id, version)
);

CREATE TABLE dataset_item (
    release_id         VARCHAR(64) NOT NULL REFERENCES dataset_release (id),
    ord                INT         NOT NULL,
    task_id            VARCHAR(64) NOT NULL,
    annotation_version BIGINT      NOT NULL,
    split              VARCHAR(8)  NOT NULL CHECK (split IN ('train', 'val', 'test')),
    record_json        TEXT        NOT NULL,
    PRIMARY KEY (release_id, ord)
);
CREATE INDEX idx_dataset_item_task ON dataset_item (task_id);
