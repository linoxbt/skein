CREATE TABLE "error_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"service" text NOT NULL,
	"fingerprint" text NOT NULL,
	"message" text NOT NULL,
	"route" text,
	"request_id" text,
	"stack" text
);
--> statement-breakpoint
CREATE INDEX "error_log_at" ON "error_log" USING btree ("at");
--> statement-breakpoint
ALTER TABLE "error_log" ENABLE ROW LEVEL SECURITY;