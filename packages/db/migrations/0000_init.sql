CREATE TABLE "consumers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"wallet" text,
	"api_key_hash" text,
	"plan" text DEFAULT 'partner' NOT NULL,
	"daily_cap_uusdc" bigint DEFAULT 2000000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"token" text NOT NULL,
	"label" text NOT NULL,
	"label_source_url" text NOT NULL,
	"label_event_at" timestamp with time zone,
	"as_of_block" bigint NOT NULL,
	"split" text NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"system" text NOT NULL,
	"case_id" text NOT NULL,
	"decision" text NOT NULL,
	"cost_uusdc" bigint NOT NULL,
	"latency_ms" integer NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"verdict_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"verdict_id" text NOT NULL,
	"ordinal" smallint NOT NULL,
	"check" text NOT NULL,
	"status" text NOT NULL,
	"severity" smallint NOT NULL,
	"metric" text,
	"value" double precision,
	"unit" text,
	"confidence" double precision NOT NULL,
	"source_group" text NOT NULL,
	"evidence" jsonb,
	"notes" jsonb NOT NULL,
	"adapter_version" text,
	"unpurchased" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intent_status" (
	"intent" text PRIMARY KEY NOT NULL,
	"exists" boolean NOT NULL,
	"onchain_ready" boolean,
	"miner_count" integer NOT NULL,
	"p50_ms" integer,
	"p95_ms" integer,
	"error_rate_24h" double precision,
	"checked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "miner_catalog" (
	"miner_id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"intents" jsonb NOT NULL,
	"status" text NOT NULL,
	"min_price_uusdc" bigint NOT NULL,
	"base_url" text NOT NULL,
	"source_group" text NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" text NOT NULL,
	"version" text NOT NULL,
	"yaml" text NOT NULL,
	"sha256" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policies_id_version_pk" PRIMARY KEY("id","version")
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"verdict_id" text NOT NULL,
	"check" text NOT NULL,
	"intent" text NOT NULL,
	"miner_id" text,
	"miner_name" text,
	"pinned" boolean NOT NULL,
	"skipped" jsonb,
	"rail" text NOT NULL,
	"http_status" integer,
	"receipt_hash" text,
	"signal_hash" text,
	"amount_uusdc" bigint NOT NULL,
	"epoch_id" bigint,
	"tx_hash" text,
	"duration_ms" integer NOT NULL,
	"attempts" smallint NOT NULL,
	"result_shape" text,
	"raw_result" jsonb,
	"error" text,
	"source_group" text NOT NULL,
	"adapter_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spend_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"amount_uusdc" bigint NOT NULL,
	"ref" text
);
--> statement-breakpoint
CREATE TABLE "verdicts" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_chain_id" integer NOT NULL,
	"subject_token" text NOT NULL,
	"policy_id" text NOT NULL,
	"policy_version" text NOT NULL,
	"engine_version" text NOT NULL,
	"verdict" text NOT NULL,
	"verdict_code" smallint NOT NULL,
	"risk_bps" integer NOT NULL,
	"confidence_bps" integer NOT NULL,
	"coverage_bps" integer NOT NULL,
	"summary" text NOT NULL,
	"reasons" jsonb NOT NULL,
	"open_risks" jsonb NOT NULL,
	"conflicts" jsonb NOT NULL,
	"verdict_hash" text NOT NULL,
	"bom_root" text NOT NULL,
	"bom_items" integer NOT NULL,
	"price_uusdc" bigint NOT NULL,
	"upstream_uusdc" bigint NOT NULL,
	"channel" text NOT NULL,
	"network" text NOT NULL,
	"consumer_id" uuid,
	"idempotency_key" text,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verdicts_bps" CHECK ("verdicts"."risk_bps" between 0 and 10000 and "verdicts"."confidence_bps" between 0 and 10000 and "verdicts"."coverage_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"consumer_id" uuid NOT NULL,
	"url" text NOT NULL,
	"secret_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_case_id_eval_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."eval_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_verdict_id_verdicts_id_fk" FOREIGN KEY ("verdict_id") REFERENCES "public"."verdicts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_verdict_id_verdicts_id_fk" FOREIGN KEY ("verdict_id") REFERENCES "public"."verdicts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_consumer_id_consumers_id_fk" FOREIGN KEY ("consumer_id") REFERENCES "public"."consumers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_consumer_id_consumers_id_fk" FOREIGN KEY ("consumer_id") REFERENCES "public"."consumers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_verdict" ON "events" USING btree ("verdict_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "findings_verdict_ordinal" ON "findings" USING btree ("verdict_id","ordinal");--> statement-breakpoint
CREATE INDEX "purchases_verdict" ON "purchases" USING btree ("verdict_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_receipt" ON "purchases" USING btree ("receipt_hash");--> statement-breakpoint
CREATE INDEX "spend_ledger_ts" ON "spend_ledger" USING btree ("ts");--> statement-breakpoint
CREATE UNIQUE INDEX "verdicts_consumer_idempotency" ON "verdicts" USING btree ("consumer_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "verdicts_subject" ON "verdicts" USING btree ("subject_chain_id","subject_token","policy_id","created_at");