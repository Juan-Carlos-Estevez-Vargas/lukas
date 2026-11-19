CREATE TABLE "app"."exchange_rates" (
	"base" char(3) NOT NULL,
	"quote" char(3) NOT NULL,
	"day" date NOT NULL,
	"rate" numeric(18, 6) NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_rates_base_quote_day_pk" PRIMARY KEY("base","quote","day"),
	CONSTRAINT "exchange_rates_positive" CHECK ("app"."exchange_rates"."rate" > 0)
);
