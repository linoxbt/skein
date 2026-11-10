CREATE TABLE "alert_state" (
	"key" text PRIMARY KEY NOT NULL,
	"failing" boolean DEFAULT false NOT NULL,
	"since" timestamp with time zone,
	"last_sent" timestamp with time zone,
	"detail" text
);
--> statement-breakpoint
CREATE TABLE "heartbeats" (
	"name" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"detail" text
);

--> statement-breakpoint
ALTER TABLE "alert_state" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "heartbeats" ENABLE ROW LEVEL SECURITY;