ALTER TABLE "deliveries" ADD COLUMN "chain_key" text;--> statement-breakpoint
UPDATE "deliveries" SET "chain_key" = "dedupe_key" WHERE "chain_key" IS NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "chain_key" SET NOT NULL;
