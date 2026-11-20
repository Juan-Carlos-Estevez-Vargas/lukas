CREATE TYPE "app"."push_platform" AS ENUM('android', 'ios');--> statement-breakpoint
CREATE TABLE "app"."push_devices" (
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"platform" "app"."push_platform" NOT NULL,
	"weekly_summary" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_devices_user_id_token_pk" PRIMARY KEY("user_id","token"),
	CONSTRAINT "push_devices_token_shape" CHECK (length("app"."push_devices"."token") BETWEEN 10 AND 200)
);
--> statement-breakpoint
ALTER TABLE "app"."push_devices" ADD CONSTRAINT "push_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_devices_token_idx" ON "app"."push_devices" USING btree ("token");--> statement-breakpoint
-- Cada persona registra y borra sus propios teléfonos; el cron del resumen lee como dueño.
GRANT SELECT, INSERT, UPDATE, DELETE ON app.push_devices TO lukas_app;
--> statement-breakpoint
ALTER TABLE app.push_devices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY push_devices_own ON app.push_devices FOR ALL TO lukas_app
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());
