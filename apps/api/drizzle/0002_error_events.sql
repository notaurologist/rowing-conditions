CREATE TABLE "error_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "error_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"details" jsonb,
	"route" text,
	CONSTRAINT "error_events_level" CHECK ("error_events"."level" in ('warn', 'error'))
);
--> statement-breakpoint
CREATE INDEX "error_events_occurred_at" ON "error_events" USING btree ("occurred_at");