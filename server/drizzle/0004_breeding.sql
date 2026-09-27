CREATE TABLE `player_recipes` (
	`player_id` text NOT NULL,
	`result` text NOT NULL,
	`discovered_at` integer NOT NULL,
	PRIMARY KEY(`player_id`, `result`),
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `players` ADD `pity_normal` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `players` ADD `pity_rare` integer DEFAULT 0 NOT NULL;