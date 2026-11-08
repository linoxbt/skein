CREATE TABLE "kv" (
	"consumer_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"etag" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kv_consumer_id_key_pk" PRIMARY KEY("consumer_id","key")
);
--> statement-breakpoint
ALTER TABLE "kv" ADD CONSTRAINT "kv_consumer_id_consumers_id_fk" FOREIGN KEY ("consumer_id") REFERENCES "public"."consumers"("id") ON DELETE no action ON UPDATE no action;