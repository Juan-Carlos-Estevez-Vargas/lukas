CREATE TYPE "app"."legal_document" AS ENUM('privacy', 'terms');--> statement-breakpoint
CREATE TABLE "app"."legal_consents" (
	"user_id" text NOT NULL,
	"document" "app"."legal_document" NOT NULL,
	"version" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_consents_user_id_document_version_pk" PRIMARY KEY("user_id","document","version"),
	CONSTRAINT "legal_consents_version" CHECK ("app"."legal_consents"."version" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);
--> statement-breakpoint
ALTER TABLE "app"."legal_consents" ADD CONSTRAINT "legal_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- La persona registra y lee sus propias autorizaciones; no las cambia ni las borra.
GRANT SELECT, INSERT ON app.legal_consents TO lukas_app;
--> statement-breakpoint
ALTER TABLE app.legal_consents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY legal_consents_read_own ON app.legal_consents FOR SELECT TO lukas_app
  USING (user_id = app.current_user_id());
--> statement-breakpoint
CREATE POLICY legal_consents_insert_own ON app.legal_consents FOR INSERT TO lukas_app
  WITH CHECK (user_id = app.current_user_id());
