-- Every table has row-level security on (as 0001 and 0003 set for the others):
-- the API connects as the table owner, so nothing it does changes, while any
-- other role that reaches the database sees no rows of the Desk's store.
ALTER TABLE "kv" ENABLE ROW LEVEL SECURITY;
