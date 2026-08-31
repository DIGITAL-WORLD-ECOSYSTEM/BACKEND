CREATE TABLE `event_inbox` (
  `id` text PRIMARY KEY NOT NULL,
  `provider_id` integer NOT NULL,
  `external_event_id` text NOT NULL,
  `payload` text NOT NULL,
  `processed_at` integer,
  CONSTRAINT "uq_event_inbox_provider_event" UNIQUE(`provider_id`, `external_event_id`)
);
