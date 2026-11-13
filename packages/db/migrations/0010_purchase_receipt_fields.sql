CREATE TABLE "miner_requests" (
	"request_id" text PRIMARY KEY NOT NULL,
	"verdict_id" text,
	"run_id" text,
	"code" text,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "receipt_timestamp" bigint;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "payer" text;--> statement-breakpoint
CREATE INDEX "miner_requests_answered" ON "miner_requests" USING btree ("answered_at");--> statement-breakpoint
ALTER TABLE "miner_requests" ENABLE ROW LEVEL SECURITY;