CREATE TABLE "gauges" (
	"ref" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"name" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"metrics" text[] DEFAULT '{}'::text[] NOT NULL,
	"has_flow_forecast" boolean,
	"linked_ref" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gauges_source" CHECK ("gauges"."source" in ('usgs', 'nwps')),
	CONSTRAINT "gauges_ref_matches_source" CHECK ("gauges"."ref" like "gauges"."source" || ':%'),
	CONSTRAINT "gauges_lat" CHECK ("gauges"."lat" between -90 and 90),
	CONSTRAINT "gauges_lon" CHECK ("gauges"."lon" between -180 and 180)
);
--> statement-breakpoint
CREATE TABLE "source_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "source_cache_expires_after_fetch" CHECK ("source_cache"."expires_at" >= "source_cache"."fetched_at")
);
--> statement-breakpoint
CREATE INDEX "gauges_linked_ref" ON "gauges" USING btree ("linked_ref");