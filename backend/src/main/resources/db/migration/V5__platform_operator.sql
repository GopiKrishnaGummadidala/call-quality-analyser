-- Platform operator: runs the platform (e.g. the demo reset) but belongs to no customer organisation and has no
-- access to any tenant's content. Tenant ADMINs manage only their own organisation.
ALTER TABLE app_user DROP CONSTRAINT ck_app_user_global_role;
ALTER TABLE app_user ADD CONSTRAINT ck_app_user_global_role CHECK (global_role IN ('USER', 'ADMIN', 'OPERATOR'));
