CREATE TABLE `dungeon_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`player_id` text NOT NULL,
	`dungeon_id` text NOT NULL,
	`party_size` integer NOT NULL,
	`entered_at` integer NOT NULL,
	`finished_at` integer,
	`result` text,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dungeon_entries_player` ON `dungeon_entries` (`player_id`,`entered_at`);--> statement-breakpoint
ALTER TABLE `players` ADD `shards_rare` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `players` ADD `shards_legend` integer DEFAULT 0 NOT NULL;