-- User management by organisation admins.
-- sessions_valid_after: tokens issued before this instant are rejected, so changing a user's account role or
-- password takes effect at once instead of when their 8-hour token expires.
ALTER TABLE app_user ADD COLUMN sessions_valid_after TIMESTAMP WITH TIME ZONE;

-- Who created or changed which account, and what changed (never a password). Account changes are not tied to a
-- project, so they get their own trail next to audit_event.
CREATE TABLE account_event (
    seq            BIGINT GENERATED ALWAYS AS IDENTITY,
    id             VARCHAR(64) PRIMARY KEY,
    tenant_id      VARCHAR(64) NOT NULL REFERENCES tenant (id),
    actor_id       VARCHAR(64) NOT NULL REFERENCES app_user (id),
    target_user_id VARCHAR(64) NOT NULL REFERENCES app_user (id),
    action         VARCHAR(64) NOT NULL,
    metadata_json  TEXT        NOT NULL,
    created_at     TIMESTAMP WITH TIME ZONE NOT NULL
);
CREATE INDEX idx_account_event_tenant ON account_event (tenant_id, seq);
