CREATE TABLE "bulk_job_items" (
	"job_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"message" text,
	CONSTRAINT "bulk_job_items_job_id_product_id_pk" PRIMARY KEY("job_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "bulk_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"filter" jsonb NOT NULL,
	"operation" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"applied" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"reverted_count" integer DEFAULT 0 NOT NULL,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"lease_until" timestamp with time zone,
	"locked_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "bulk_jobs_status_ck" CHECK ("bulk_jobs"."status" in ('queued','running','cancelling','cancelled','done','failed','reverting','reverted'))
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"state" text NOT NULL,
	"status_code" smallint,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_user_id_key_pk" PRIMARY KEY("user_id","key"),
	CONSTRAINT "idem_state_ck" CHECK ("idempotency_keys"."state" in ('in_progress','done'))
);
--> statement-breakpoint
CREATE TABLE "product_changes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"field" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"version" integer NOT NULL,
	"source" text NOT NULL,
	"user_id" uuid,
	"job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "changes_source_ck" CHECK ("product_changes"."source" in ('edit','paste','fill','bulk','restore','revert','undo'))
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"price" numeric(14, 2),
	"old_price" numeric(14, 2),
	"stock" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"arrival_date" date,
	"versions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_price_ck" CHECK ("products"."price" is null or "products"."price" > 0),
	CONSTRAINT "products_old_price_ck" CHECK ("products"."old_price" is null or ("products"."price" is not null and "products"."old_price" > "products"."price")),
	CONSTRAINT "products_stock_ck" CHECK ("products"."stock" >= 0),
	CONSTRAINT "products_name_ck" CHECK (char_length("products"."name") between 1 and 200),
	CONSTRAINT "products_status_ck" CHECK ("products"."status" in ('draft','active','archived')),
	CONSTRAINT "products_active_ck" CHECK ("products"."status" <> 'active' or ("products"."price" is not null and "products"."category" is not null))
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_categories" (
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	CONSTRAINT "user_categories_user_id_category_pk" PRIMARY KEY("user_id","category")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"login" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_role_ck" CHECK ("users"."role" in ('admin','editor','viewer'))
);
--> statement-breakpoint
ALTER TABLE "bulk_job_items" ADD CONSTRAINT "bulk_job_items_job_id_bulk_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."bulk_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_jobs" ADD CONSTRAINT "bulk_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_changes" ADD CONSTRAINT "product_changes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_changes" ADD CONSTRAINT "product_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_categories" ADD CONSTRAINT "user_categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bulk_items_pending_idx" ON "bulk_job_items" USING btree ("job_id","state","seq");--> statement-breakpoint
CREATE INDEX "bulk_jobs_status_idx" ON "bulk_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "changes_product_field_idx" ON "product_changes" USING btree ("product_id","field","id");--> statement-breakpoint
CREATE INDEX "changes_job_idx" ON "product_changes" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_sku_uq" ON "products" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category");--> statement-breakpoint
CREATE INDEX "products_status_idx" ON "products" USING btree ("status");--> statement-breakpoint
CREATE INDEX "rate_limits_window_idx" ON "rate_limits" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_login_uq" ON "users" USING btree ("login");