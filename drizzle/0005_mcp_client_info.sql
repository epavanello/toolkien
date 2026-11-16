CREATE TABLE `mcp_client_info` (
	`user_id` text NOT NULL,
	`client_id` text NOT NULL,
	`info` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`user_id`, `client_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `execution` ADD `client_name` text;--> statement-breakpoint
ALTER TABLE `execution` ADD `client_info` text;--> statement-breakpoint
ALTER TABLE `audit_event` ADD `client_info` text;