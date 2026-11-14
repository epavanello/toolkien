CREATE TABLE `tool_search_text` (
	`tool_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`tool_id`) REFERENCES `tool`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connector_id`) REFERENCES `connector`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tool_search_text_workspace_idx` ON `tool_search_text` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `tool_search_text_connector_idx` ON `tool_search_text` (`connector_id`);