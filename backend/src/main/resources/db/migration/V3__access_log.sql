-- Read-access log: who opened which task or played which recording, including denied attempts.
-- Kept separate from audit_event (state changes) so the task's history stays readable and so this table can get
-- its own retention and export rules. Written before the data is returned: if it cannot be written, the read fails.

CREATE TABLE access_log (
    seq        BIGINT GENERATED ALWAYS AS IDENTITY,
    id         VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES project (id),
    task_id    VARCHAR(64) NOT NULL,
    user_id    VARCHAR(64) NOT NULL REFERENCES app_user (id),
    action     VARCHAR(32) NOT NULL CHECK (action IN ('VIEW_TASK', 'READ_AUDIO')),
    outcome    VARCHAR(16) NOT NULL CHECK (outcome IN ('ALLOWED', 'DENIED')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL
);
CREATE INDEX idx_access_log_project_time ON access_log (project_id, created_at);
CREATE INDEX idx_access_log_task ON access_log (task_id);
