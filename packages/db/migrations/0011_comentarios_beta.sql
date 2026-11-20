CREATE TYPE "app"."feedback_kind" AS ENUM('bug', 'idea', 'other');--> statement-breakpoint
CREATE TABLE "app"."feedback" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" "app"."feedback_kind" NOT NULL,
	"message" text NOT NULL,
	"app_version" text NOT NULL,
	"platform" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_message_length" CHECK (char_length("app"."feedback"."message") between 5 and 2000),
	CONSTRAINT "feedback_platform" CHECK ("app"."feedback"."platform" in ('android', 'ios', 'web')),
	CONSTRAINT "feedback_app_version" CHECK (char_length("app"."feedback"."app_version") <= 32)
);
--> statement-breakpoint
ALTER TABLE "app"."feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_created_at" ON "app"."feedback" USING btree ("created_at");--> statement-breakpoint
-- La persona deja sus comentarios pero no los lee ni los cambia; el equipo los lee como dueño.
GRANT INSERT ON app.feedback TO lukas_app;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE app.feedback_id_seq TO lukas_app;
--> statement-breakpoint
ALTER TABLE app.feedback ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY feedback_insert_own ON app.feedback FOR INSERT TO lukas_app
  WITH CHECK (user_id = app.current_user_id());
