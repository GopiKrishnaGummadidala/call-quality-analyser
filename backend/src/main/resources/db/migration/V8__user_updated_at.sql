-- When an account was created or last changed, so admin lists can show the most recent first.
ALTER TABLE app_user ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL;
