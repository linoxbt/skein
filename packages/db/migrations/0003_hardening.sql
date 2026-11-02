CREATE TABLE "spend_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" text NOT NULL,
	"run_id" text NOT NULL,
	"channel" text NOT NULL,
	"consumer_id" uuid,
	"reserved_uusdc" bigint NOT NULL,
	"spent_uusdc" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "verdict_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"consumer_id" uuid,
	"idempotency_key" text,
	"request_hash" text,
	"channel" text NOT NULL,
	"subject_chain_id" integer NOT NULL,
	"subject_token" text NOT NULL,
	"policy_id" text NOT NULL,
	"policy_version" text NOT NULL,
	"context_hash" text NOT NULL,
	"status" text NOT NULL,
	"verdict_id" text,
	"outcome" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "purchases" DROP CONSTRAINT "purchases_verdict_id_verdicts_id_fk";
--> statement-breakpoint
ALTER TABLE "consumers" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "consumers" ADD COLUMN "seeded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "seq" integer;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "billing" text DEFAULT 'paid' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "signal_status" text;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "pool" text;--> statement-breakpoint
ALTER TABLE "verdicts" ADD COLUMN "policy_sha256" text;--> statement-breakpoint
ALTER TABLE "verdicts" ADD COLUMN "pricing_rule" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "verdicts" ADD COLUMN "context_hash" text;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "secret" text NOT NULL;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "verdict_runs" ADD CONSTRAINT "verdict_runs_consumer_id_consumers_id_fk" FOREIGN KEY ("consumer_id") REFERENCES "public"."consumers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "spend_holds_day" ON "spend_holds" USING btree ("day","channel","consumer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "verdict_runs_consumer_idempotency" ON "verdict_runs" USING btree ("consumer_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "verdict_runs_status" ON "verdict_runs" USING btree ("status","started_at");--> statement-breakpoint
-- Every existing verdict becomes a finished run, so its purchases keep a parent.
INSERT INTO "verdict_runs" ("id","consumer_id","idempotency_key","request_hash","channel","subject_chain_id","subject_token","policy_id","policy_version","context_hash","status","verdict_id","started_at","finished_at")
SELECT "id","consumer_id","idempotency_key","request_hash","channel","subject_chain_id","subject_token","policy_id","policy_version",'legacy','done',"id","created_at","created_at" FROM "verdicts"
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_verdict_id_verdict_runs_id_fk" FOREIGN KEY ("verdict_id") REFERENCES "public"."verdict_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchases_created" ON "purchases" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "verdicts_channel_created" ON "verdicts" USING btree ("channel","created_at");--> statement-breakpoint
-- Row triggers do not fire on TRUNCATE: refuse it on the evidence tables too.
CREATE FUNCTION skein_forbid_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: TRUNCATE refused', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER purchases_no_truncate BEFORE TRUNCATE ON purchases FOR EACH STATEMENT EXECUTE FUNCTION skein_forbid_truncate();
--> statement-breakpoint
CREATE TRIGGER findings_no_truncate BEFORE TRUNCATE ON findings FOR EACH STATEMENT EXECUTE FUNCTION skein_forbid_truncate();
--> statement-breakpoint
CREATE TRIGGER verdicts_no_truncate BEFORE TRUNCATE ON verdicts FOR EACH STATEMENT EXECUTE FUNCTION skein_forbid_truncate();
--> statement-breakpoint
CREATE TRIGGER policies_no_truncate BEFORE TRUNCATE ON policies FOR EACH STATEMENT EXECUTE FUNCTION skein_forbid_truncate();
--> statement-breakpoint
-- The money record is append-only too.
CREATE TRIGGER spend_ledger_append_only BEFORE UPDATE OR DELETE ON spend_ledger FOR EACH ROW EXECUTE FUNCTION skein_forbid_change();
--> statement-breakpoint
CREATE TRIGGER spend_ledger_no_truncate BEFORE TRUNCATE ON spend_ledger FOR EACH STATEMENT EXECUTE FUNCTION skein_forbid_truncate();
--> statement-breakpoint
-- A settled hold is history: only an open hold may change (once, to settle it).
CREATE FUNCTION skein_hold_settle_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.settled_at IS NOT NULL THEN
    RAISE EXCEPTION 'spend_holds: a settled hold is final' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER spend_holds_settle_once BEFORE UPDATE OR DELETE ON spend_holds FOR EACH ROW EXECUTE FUNCTION skein_hold_settle_once();
--> statement-breakpoint
ALTER TABLE "verdict_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "spend_holds" ENABLE ROW LEVEL SECURITY;
