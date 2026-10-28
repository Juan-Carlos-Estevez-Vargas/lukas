CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TYPE "app"."account_type" AS ENUM('cash', 'bank', 'digital_wallet', 'credit_card', 'loan', 'investment', 'other_asset', 'other_liability');--> statement-breakpoint
CREATE TYPE "app"."category_kind" AS ENUM('income', 'expense', 'equity', 'trading');--> statement-breakpoint
CREATE TYPE "app"."transaction_source" AS ENUM('manual', 'notification', 'statement', 'receipt', 'email', 'import', 'recurring');--> statement-breakpoint
CREATE TYPE "app"."transaction_status" AS ENUM('pending', 'cleared', 'reconciled');--> statement-breakpoint
CREATE TYPE "app"."change_op" AS ENUM('upsert', 'delete');--> statement-breakpoint
CREATE TABLE "app"."accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"type" "app"."account_type" NOT NULL,
	"currency" char(3) NOT NULL,
	"institution" text,
	"last4" char(4),
	"closing_day" smallint,
	"due_day" smallint,
	"credit_limit_minor" bigint,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "accounts_last4_digits" CHECK ("app"."accounts"."last4" IS NULL OR "app"."accounts"."last4" ~ '^[0-9]{4}$'),
	CONSTRAINT "accounts_closing_day" CHECK ("app"."accounts"."closing_day" IS NULL OR "app"."accounts"."closing_day" BETWEEN 1 AND 31),
	CONSTRAINT "accounts_due_day" CHECK ("app"."accounts"."due_day" IS NULL OR "app"."accounts"."due_day" BETWEEN 1 AND 31)
);
--> statement-breakpoint
CREATE TABLE "app"."categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"kind" "app"."category_kind" NOT NULL,
	"icon" text,
	"color" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"account_id" uuid,
	"category_id" uuid,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	CONSTRAINT "entries_account_xor_category" CHECK (("app"."entries"."account_id" IS NULL) <> ("app"."entries"."category_id" IS NULL)),
	CONSTRAINT "entries_amount_not_zero" CHECK ("app"."entries"."amount_minor" <> 0)
);
--> statement-breakpoint
CREATE TABLE "app"."transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"merchant" text,
	"notes" text,
	"status" "app"."transaction_status" DEFAULT 'cleared' NOT NULL,
	"source" "app"."transaction_source" DEFAULT 'manual' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."changes" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"op" "app"."change_op" NOT NULL,
	"version" integer NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."idempotency_keys" (
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
CREATE TABLE "app"."outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"aggregate" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app"."categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "app"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."entries" ADD CONSTRAINT "entries_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "app"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."entries" ADD CONSTRAINT "entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "app"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."entries" ADD CONSTRAINT "entries_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "app"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "app"."accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "categories_user_idx" ON "app"."categories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "entries_transaction_idx" ON "app"."entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "entries_account_idx" ON "app"."entries" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "entries_category_idx" ON "app"."entries" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "transactions_user_occurred_idx" ON "app"."transactions" USING btree ("user_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_user_idx" ON "app"."audit_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "changes_user_seq_idx" ON "app"."changes" USING btree ("user_id","seq");--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "app"."outbox" USING btree ("created_at");