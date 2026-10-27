CREATE TABLE "forecast_archive" (
	"source" text NOT NULL,
	"ref" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"points" jsonb NOT NULL,
	CONSTRAINT "forecast_archive_source_ref_issued_at_pk" PRIMARY KEY("source","ref","issued_at"),
	CONSTRAINT "forecast_archive_source" CHECK ("forecast_archive"."source" in ('nwps'))
);
--> statement-breakpoint
CREATE INDEX "forecast_archive_issued_at" ON "forecast_archive" USING btree ("issued_at");