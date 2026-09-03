CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bin_id" uuid NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"query" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"body" "bytea" NOT NULL,
	"body_size" integer NOT NULL,
	"truncated" boolean DEFAULT false NOT NULL,
	"content_type" text,
	"source_ip" "inet",
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_bin_id_bins_id_fk" FOREIGN KEY ("bin_id") REFERENCES "public"."bins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "requests_bin_received_idx" ON "requests" USING btree ("bin_id","received_at" DESC NULLS LAST,id desc);