CREATE TABLE `custom_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`topic` text NOT NULL,
	`data` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `question_status` (
	`question_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`updated_by` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `teacher_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`teacher_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `teacher_sessions_teacher` ON `teacher_sessions` (`teacher_id`);--> statement-breakpoint
CREATE TABLE `teachers` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teachers_username_unique` ON `teachers` (`username`);--> statement-breakpoint
ALTER TABLE `classrooms` ADD `teacher_id` text REFERENCES teachers(id);--> statement-breakpoint
ALTER TABLE `classrooms` ADD `timer_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `classrooms` ADD `topics` text;--> statement-breakpoint
ALTER TABLE `classrooms` ADD `dungeon_entries` integer;