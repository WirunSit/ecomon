CREATE TABLE `catalog` (
	`player_id` text NOT NULL,
	`species_id` text NOT NULL,
	`form` integer NOT NULL,
	`seen_at` integer NOT NULL,
	`owned_at` integer,
	PRIMARY KEY(`player_id`, `species_id`, `form`),
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `players` ADD `title_id` text;--> statement-breakpoint
ALTER TABLE `players` ADD `frame_id` text;--> statement-breakpoint
ALTER TABLE `players` ADD `catalog_rewards` integer DEFAULT 0 NOT NULL;