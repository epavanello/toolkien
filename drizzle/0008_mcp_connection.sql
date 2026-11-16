CREATE TABLE `mcp_connection` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`client_id` text NOT NULL,
	`label` text,
	`client_info` text,
	`workspace_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `mcp_connection_user_idx` ON `mcp_connection` (`user_id`,`client_id`);--> statement-breakpoint
DROP TABLE `mcp_active_workspace`;--> statement-breakpoint
DROP TABLE `mcp_client_info`;--> statement-breakpoint
DROP TABLE `mcp_client_label`;--> statement-breakpoint
ALTER TABLE `execution` ADD `connection_id` text;--> statement-breakpoint
ALTER TABLE `audit_event` ADD `connection_id` text;--> statement-breakpoint
CREATE INDEX `audit_event_connection_idx` ON `audit_event` (`connection_id`,`occurred_at`);--> statement-breakpoint
-- Custom: grants made before connections existed carry no `reference_id`, so their tokens
-- cannot name a connection. Drop them: every MCP client signs in again (users, workspaces and
-- connectors are untouched; OAuth client registrations stay).
DELETE FROM `oauth_access_token`;--> statement-breakpoint
DELETE FROM `oauth_refresh_token`;--> statement-breakpoint
DELETE FROM `oauth_consent`;--> statement-breakpoint
-- Custom: the append-only guard also covers the columns added since 0001
DROP TRIGGER IF EXISTS `audit_event_append_only`;--> statement-breakpoint
CREATE TRIGGER `audit_event_append_only` BEFORE UPDATE ON `audit_event`
WHEN NOT (
	NEW.`id` IS OLD.`id`
	AND NEW.`occurred_at` IS OLD.`occurred_at`
	AND NEW.`type` IS OLD.`type`
	AND NEW.`workspace_id` IS OLD.`workspace_id`
	AND NEW.`client_id` IS OLD.`client_id`
	AND NEW.`client_name` IS OLD.`client_name`
	AND NEW.`client_info` IS OLD.`client_info`
	AND NEW.`connection_id` IS OLD.`connection_id`
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
