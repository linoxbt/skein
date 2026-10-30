-- Evidence cannot be edited after the fact (build spec section 7 and 9).
-- Triggers fire for every role, including the service role the API uses, so
-- append-only holds even where grants would not.
CREATE FUNCTION skein_forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % refused', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER purchases_append_only BEFORE UPDATE OR DELETE ON purchases FOR EACH ROW EXECUTE FUNCTION skein_forbid_change();
--> statement-breakpoint
CREATE TRIGGER findings_append_only BEFORE UPDATE OR DELETE ON findings FOR EACH ROW EXECUTE FUNCTION skein_forbid_change();
--> statement-breakpoint
CREATE TRIGGER verdicts_append_only BEFORE UPDATE OR DELETE ON verdicts FOR EACH ROW EXECUTE FUNCTION skein_forbid_change();
--> statement-breakpoint
-- A published policy is immutable; a change is a new version.
CREATE TRIGGER policies_immutable BEFORE UPDATE OR DELETE ON policies FOR EACH ROW EXECUTE FUNCTION skein_forbid_change();
--> statement-breakpoint
-- Row Level Security on every table, with no policies: the browser roles see
-- nothing, and public reads go through the API.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['consumers','policies','verdicts','purchases','findings','miner_catalog','intent_status',
                           'spend_ledger','webhooks','events','eval_cases','eval_runs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
  -- Supabase's browser roles; absent on a plain Postgres.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
  END IF;
END;
$$;
