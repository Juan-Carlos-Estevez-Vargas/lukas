CREATE TABLE "app"."payment_checkouts" (
	"reference" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"price_id" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_checkouts_reference_shape" CHECK ("app"."payment_checkouts"."reference" ~ '^lk[0-9a-z]{24}$'),
	CONSTRAINT "payment_checkouts_amount_positive" CHECK ("app"."payment_checkouts"."amount_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "app"."payment_checkouts" ADD CONSTRAINT "payment_checkouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_checkouts_user_idx" ON "app"."payment_checkouts" USING btree ("user_id","created_at");--> statement-breakpoint
-- Solo del servidor: la API la escribe al abrir el checkout y la lee en el webhook, como dueño.
ALTER TABLE app.payment_checkouts ENABLE ROW LEVEL SECURITY;
