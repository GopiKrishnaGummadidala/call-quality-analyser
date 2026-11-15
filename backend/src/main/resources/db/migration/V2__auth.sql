-- Credentials and account-level role for real sign-in (replaces the X-User-Id demo header).
-- Project roles (ANNOTATOR / REVIEWER) stay in project_membership and are resolved per request.

ALTER TABLE app_user ADD COLUMN username VARCHAR(64);
ALTER TABLE app_user ADD COLUMN password_hash VARCHAR(255);
ALTER TABLE app_user ADD COLUMN global_role VARCHAR(16) DEFAULT 'USER' NOT NULL;
ALTER TABLE app_user ADD CONSTRAINT ck_app_user_global_role CHECK (global_role IN ('USER', 'ADMIN'));
CREATE UNIQUE INDEX ux_app_user_username ON app_user (username);
