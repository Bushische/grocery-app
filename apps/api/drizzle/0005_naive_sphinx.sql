CREATE TABLE `telegram_chat_defaults` (
	`chat_id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`set_by_user_id` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`set_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
