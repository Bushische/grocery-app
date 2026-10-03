CREATE TABLE `telegram_links` (
	`user_id` text PRIMARY KEY NOT NULL,
	`telegram_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_links_telegram_id_uq` ON `telegram_links` (`telegram_id`);