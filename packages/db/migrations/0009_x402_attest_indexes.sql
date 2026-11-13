CREATE TABLE "verdict_attestations" (
	"verdict_id" text PRIMARY KEY NOT NULL,
	"scheme" text NOT NULL,
	"signer" text NOT NULL,
	"message" text NOT NULL,
	"signature" text NOT NULL,
	"at_seal" boolean NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "x402_payments" (
	"key" text PRIMARY KEY NOT NULL,
	"payer" text NOT NULL,
	"nonce" text NOT NULL,
	"amount_uusdc" bigint NOT NULL,
	"network" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text NOT NULL,
	"tx_hash" text,
	"error" text,
	"run_id" text,
	"refund_uusdc" bigint DEFAULT 0 NOT NULL,
	"refund_reason" text,
	"refunded_at" timestamp with time zone,
	"refund_tx" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "purchase_id" uuid;--> statement-breakpoint
ALTER TABLE "verdict_attestations" ADD CONSTRAINT "verdict_attestations_verdict_id_verdicts_id_fk" FOREIGN KEY ("verdict_id") REFERENCES "public"."verdicts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "x402_payments_payer" ON "x402_payments" USING btree ("payer","created_at");--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rate_limits_at" ON "rate_limits" USING btree ("at");--> statement-breakpoint
CREATE INDEX "spend_ledger_kind_ref" ON "spend_ledger" USING btree ("kind","ref");--> statement-breakpoint
CREATE INDEX "verdicts_created" ON "verdicts" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "x402_payments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "verdict_attestations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A stored signature is evidence: append-only, like the verdict it signs.
CREATE TRIGGER verdict_attestations_append_only BEFORE UPDATE OR DELETE ON verdict_attestations FOR EACH ROW EXECUTE FUNCTION skein_forbid_change();
--> statement-breakpoint
CREATE TRIGGER verdict_attestations_no_truncate BEFORE TRUNCATE ON verdict_attestations FOR EACH STATEMENT EXECUTE FUNCTION skein_forbid_truncate();
--> statement-breakpoint
-- A revoked partner key stays revoked: the runtime role may revoke a key and
-- adjust its cap, but never clear revoked_at or swap the key hash of a revoked row.
CREATE FUNCTION skein_revoke_final() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS NULL OR NEW.api_key_hash IS DISTINCT FROM OLD.api_key_hash) THEN
    RAISE EXCEPTION 'consumers: a revoked key cannot be restored; issue a new one' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER consumers_revoke_final BEFORE UPDATE ON consumers FOR EACH ROW EXECUTE FUNCTION skein_revoke_final();