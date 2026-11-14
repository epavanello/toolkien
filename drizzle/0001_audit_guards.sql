-- Custom migration: objects drizzle-kit cannot express.

-- The audit log is append-only. The only update allowed is anonymisation: setting
-- `user_id` / `approver_user_id` to NULL when an account is deleted. DELETE stays allowed for
-- the retention job.
CREATE TRIGGER `audit_event_append_only` BEFORE UPDATE ON `audit_event`
WHEN NOT (
	NEW.`id` IS OLD.`id`
	AND NEW.`occurred_at` IS OLD.`occurred_at`
	AND NEW.`type` IS OLD.`type`
	AND NEW.`workspace_id` IS OLD.`workspace_id`
	AND NEW.`client_id` IS OLD.`client_id`
	AND NEW.`client_name` IS OLD.`client_name`
	AND NEW.`connector_id` IS OLD.`connector_id`
	AND NEW.`tool_path` IS OLD.`tool_path`
	AND NEW.`execution_id` IS OLD.`execution_id`
	AND NEW.`outcome` IS OLD.`outcome`
	AND NEW.`duration_ms` IS OLD.`duration_ms`
	AND NEW.`approved_by` IS OLD.`approved_by`
	AND NEW.`metadata` IS OLD.`metadata`
	AND (NEW.`user_id` IS OLD.`user_id` OR NEW.`user_id` IS NULL)
	AND (NEW.`approver_user_id` IS OLD.`approver_user_id` OR NEW.`approver_user_id` IS NULL)
)
BEGIN
	SELECT RAISE(ABORT, 'audit_event is append-only');
END;
