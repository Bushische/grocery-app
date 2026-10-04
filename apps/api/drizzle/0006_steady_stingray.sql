CREATE TABLE `item_buy_history` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`bought_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `buy_history_item_bought_idx` ON `item_buy_history` (`item_id`,`bought_at`);