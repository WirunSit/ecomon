CREATE TABLE `answer_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`player_id` text NOT NULL,
	`question_id` text NOT NULL,
	`topic` text NOT NULL,
	`correct` integer NOT NULL,
	`elapsed_ms` integer NOT NULL,
	`context` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `answer_log_player` ON `answer_log` (`player_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `classrooms` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `classrooms_code_unique` ON `classrooms` (`code`);--> statement-breakpoint
CREATE TABLE `eggs` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`species_id` text NOT NULL,
	`rarity` text NOT NULL,
	`correct_required` integer NOT NULL,
	`correct_progress` integer DEFAULT 0 NOT NULL,
	`parents` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `eggs_player` ON `eggs` (`player_id`);--> statement-breakpoint
CREATE TABLE `monsters` (
	`uid` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`species_id` text NOT NULL,
	`nickname` text,
	`level` integer NOT NULL,
	`exp` integer DEFAULT 0 NOT NULL,
	`form` integer DEFAULT 1 NOT NULL,
	`moves` text NOT NULL,
	`equipment` text NOT NULL,
	`origin_type` text NOT NULL,
	`origin_zone` text,
	`parents` text,
	`locked` integer DEFAULT false NOT NULL,
	`breed_ready_at` integer,
	`team_slot` integer,
	`obtained_at` integer NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `monsters_player` ON `monsters` (`player_id`);--> statement-breakpoint
CREATE TABLE `player_items` (
	`player_id` text NOT NULL,
	`item_id` text NOT NULL,
	`tier` text DEFAULT '' NOT NULL,
	`qty` integer NOT NULL,
	PRIMARY KEY(`player_id`, `item_id`, `tier`),
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`classroom_id` text NOT NULL,
	`nickname` text NOT NULL,
	`nickname_key` text NOT NULL,
	`pin_hash` text NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`exp` integer DEFAULT 0 NOT NULL,
	`coins` integer DEFAULT 0 NOT NULL,
	`conservation_points` integer DEFAULT 0 NOT NULL,
	`partner_uid` text,
	`map_id` text,
	`x` integer,
	`y` integer,
	`facing` text,
	`failed_pin_count` integer DEFAULT 0 NOT NULL,
	`pin_locked_until` integer,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`classroom_id`) REFERENCES `classrooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `players_classroom_nickname` ON `players` (`classroom_id`,`nickname_key`);--> statement-breakpoint
CREATE TABLE `quest_progress` (
	`player_id` text NOT NULL,
	`quest_id` text NOT NULL,
	`status` text NOT NULL,
	`progress` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`player_id`, `quest_id`),
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_player` ON `sessions` (`player_id`);--> statement-breakpoint
CREATE TABLE `topic_mastery` (
	`player_id` text NOT NULL,
	`topic` text NOT NULL,
	`value` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`player_id`, `topic`),
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
