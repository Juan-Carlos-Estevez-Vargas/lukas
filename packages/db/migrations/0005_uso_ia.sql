CREATE TABLE "app"."ai_usage" (
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"tokens" integer DEFAULT 0 NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_usage_user_id_day_pk" PRIMARY KEY("user_id","day"),
	CONSTRAINT "ai_usage_counts" CHECK ("app"."ai_usage"."tokens" >= 0 AND "app"."ai_usage"."requests" >= 0)
);
--> statement-breakpoint
ALTER TABLE "app"."ai_usage" ADD CONSTRAINT "ai_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- La API cuenta el uso como la persona: RLS solo deja ver y sumar su propia fila.
GRANT SELECT, INSERT, UPDATE ON app.ai_usage TO lukas_app;
--> statement-breakpoint
ALTER TABLE app.ai_usage ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ai_usage_own ON app.ai_usage FOR ALL TO lukas_app
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());
