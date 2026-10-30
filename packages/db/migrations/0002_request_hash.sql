ALTER TABLE "verdicts" ADD COLUMN "request_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "consumers_api_key_hash" ON "consumers" USING btree ("api_key_hash");