-- pgvector viene con Neon; en pruebas lo carga PGlite.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "app"."transaction_embeddings" (
	"transaction_id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"content_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."transaction_embeddings" ADD CONSTRAINT "transaction_embeddings_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "app"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."transaction_embeddings" ADD CONSTRAINT "transaction_embeddings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transaction_embeddings_user_idx" ON "app"."transaction_embeddings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transaction_embeddings_hnsw" ON "app"."transaction_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
-- La API indexa y busca como la persona: RLS solo deja ver y escribir sus propios embeddings.
GRANT SELECT, INSERT, UPDATE, DELETE ON app.transaction_embeddings TO lukas_app;
--> statement-breakpoint
ALTER TABLE app.transaction_embeddings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY transaction_embeddings_own ON app.transaction_embeddings FOR ALL TO lukas_app
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());
