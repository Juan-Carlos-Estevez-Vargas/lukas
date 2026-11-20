ALTER TYPE "app"."billing_provider" ADD VALUE 'coupon';--> statement-breakpoint
CREATE TABLE "app"."coupon_redemptions" (
	"code" text NOT NULL,
	"user_id" text NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupon_redemptions_code_user_id_pk" PRIMARY KEY("code","user_id")
);
--> statement-breakpoint
CREATE TABLE "app"."coupons" (
	"code" text PRIMARY KEY NOT NULL,
	"days" integer NOT NULL,
	"max_redemptions" integer,
	"redemptions" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_code_shape" CHECK ("app"."coupons"."code" ~ '^[A-Z0-9][A-Z0-9-]{2,30}[A-Z0-9]$'),
	CONSTRAINT "coupons_days" CHECK ("app"."coupons"."days" BETWEEN 1 AND 366),
	CONSTRAINT "coupons_redemptions" CHECK ("app"."coupons"."redemptions" >= 0 AND ("app"."coupons"."max_redemptions" IS NULL OR "app"."coupons"."redemptions" <= "app"."coupons"."max_redemptions"))
);
--> statement-breakpoint
ALTER TABLE "app"."coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_code_coupons_code_fk" FOREIGN KEY ("code") REFERENCES "app"."coupons"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Cupones y canjes son solo del servidor: la app manda el código y la API lo canjea como dueño.
ALTER TABLE app.coupons ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.coupon_redemptions ENABLE ROW LEVEL SECURITY;
