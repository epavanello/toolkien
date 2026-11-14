CREATE TABLE `connector_icon` (
	`connector_id` text PRIMARY KEY NOT NULL,
	`content_type` text,
	`data` blob,
	`fetched_at` integer NOT NULL,
	FOREIGN KEY (`connector_id`) REFERENCES `connector`(`id`) ON UPDATE no action ON DELETE cascade
);
