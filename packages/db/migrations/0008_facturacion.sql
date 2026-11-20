CREATE TYPE "app"."billing_provider" AS ENUM('wompi', 'revenuecat', 'manual', 'trial');--> statement-breakpoint
CREATE TYPE "app"."plan" AS ENUM('free', 'premium');--> statement-breakpoint
CREATE TYPE "app"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'canceled', 'expired');--> statement-breakpoint
CREATE TABLE "app"."billing_events" (
	"provider" "app"."billing_provider" NOT NULL,
	"event_id" text NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"outcome" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_events_provider_event_id_pk" PRIMARY KEY("provider","event_id"),
	CONSTRAINT "billing_events_id_shape" CHECK (length("app"."billing_events"."event_id") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "app"."subscriptions" (
	"user_id" text PRIMARY KEY NOT NULL,
	"plan" "app"."plan" NOT NULL,
	"status" "app"."subscription_status" NOT NULL,
	"provider" "app"."billing_provider" NOT NULL,
	"provider_ref" text,
	"period_end" timestamp with time zone NOT NULL,
	"last_event_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."billing_events" ADD CONSTRAINT "billing_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_events_user_idx" ON "app"."billing_events" USING btree ("user_id","received_at");--> statement-breakpoint
CREATE INDEX "subscriptions_period_end_idx" ON "app"."subscriptions" USING btree ("period_end");--> statement-breakpoint
-- La persona solo lee su suscripción; la escriben el servidor (webhooks y saga) como dueño.
GRANT SELECT ON app.subscriptions TO lukas_app;
--> statement-breakpoint
ALTER TABLE app.subscriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY subscriptions_read_own ON app.subscriptions FOR SELECT TO lukas_app
  USING (user_id = app.current_user_id());
--> statement-breakpoint
-- Cada cambio de plan queda en la bitácora, como `system`.
CREATE TRIGGER subscriptions_audit AFTER INSERT OR UPDATE OR DELETE ON app.subscriptions
FOR EACH ROW EXECUTE FUNCTION app.audit_change();
--> statement-breakpoint
-- Los eventos de facturación son solo del servidor, como la bandeja de salida.
ALTER TABLE app.billing_events ENABLE ROW LEVEL SECURITY;
