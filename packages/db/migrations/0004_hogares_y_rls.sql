CREATE TYPE "app"."household_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TABLE "app"."household_members" (
	"household_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "app"."household_role" DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_members_household_id_user_id_pk" PRIMARY KEY("household_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "app"."households" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."accounts" ADD COLUMN "household_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."categories" ADD COLUMN "household_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."transactions" ADD COLUMN "household_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."household_members" ADD CONSTRAINT "household_members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "app"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."household_members" ADD CONSTRAINT "household_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."households" ADD CONSTRAINT "households_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "household_members_user_idx" ON "app"."household_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "app"."accounts" ADD CONSTRAINT "accounts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "app"."households"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."categories" ADD CONSTRAINT "categories_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "app"."households"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."transactions" ADD CONSTRAINT "transactions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "app"."households"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Row Level Security (FIN-201).
--
-- La API no consulta como dueña de las tablas: en cada petición abre una transacción, fija el
-- usuario con `set_config('app.user_id', …, true)` y baja al rol `lukas_app` con `SET LOCAL ROLE`
-- (ver `withUser` en src/rls.ts). Ese rol solo ve lo que permiten estas políticas: lo propio y lo
-- que se comparte con un hogar donde es miembro. Sin usuario fijado no ve nada.
-- El dueño de las tablas (migraciones, tareas programadas) no pasa por RLS.

-- 1. Rol de la aplicación, sin login: solo se llega a él con SET ROLE.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lukas_app') THEN
    CREATE ROLE lukas_app NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT lukas_app TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO lukas_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON
  app.accounts, app.categories, app.transactions, app.entries,
  app.households, app.household_members, app.changes, app.idempotency_keys
TO lukas_app;
--> statement-breakpoint
GRANT SELECT ON app.audit_log, app.exchange_rates TO lukas_app;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE app.changes_seq_seq TO lukas_app;
--> statement-breakpoint

-- 2. Funciones auxiliares. Las de hogares son SECURITY DEFINER para leer membresías sin caer en
--    recursión con las políticas de household_members.
CREATE FUNCTION app.current_user_id() RETURNS text
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.user_id', true), '') $$;
--> statement-breakpoint
CREATE FUNCTION app.my_household_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, app
AS $$
  SELECT household_id FROM app.household_members WHERE user_id = app.current_user_id()
$$;
--> statement-breakpoint
CREATE FUNCTION app.is_household_owner(h uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, app
AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.household_members
    WHERE household_id = h AND user_id = app.current_user_id() AND role = 'owner'
  )
$$;
--> statement-breakpoint
-- Solo mientras el hogar está vacío: así quien lo creó no se vuelve a nombrar dueño si lo sacan.
CREATE FUNCTION app.created_household(h uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, app
AS $$
  SELECT EXISTS (SELECT 1 FROM app.households WHERE id = h AND created_by = app.current_user_id())
    AND NOT EXISTS (SELECT 1 FROM app.household_members WHERE household_id = h)
$$;
--> statement-breakpoint

-- 3. Políticas. Leer: lo propio y lo compartido con mis hogares. Escribir: solo lo propio, y
--    solo se puede compartir con un hogar del que se es miembro.
ALTER TABLE app.accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY accounts_read ON app.accounts FOR SELECT TO lukas_app
  USING (user_id = app.current_user_id() OR household_id IN (SELECT app.my_household_ids()));
--> statement-breakpoint
CREATE POLICY accounts_write ON app.accounts FOR ALL TO lukas_app
  USING (user_id = app.current_user_id())
  WITH CHECK (
    user_id = app.current_user_id()
    AND (household_id IS NULL OR household_id IN (SELECT app.my_household_ids()))
  );
--> statement-breakpoint
ALTER TABLE app.categories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY categories_read ON app.categories FOR SELECT TO lukas_app
  USING (user_id = app.current_user_id() OR household_id IN (SELECT app.my_household_ids()));
--> statement-breakpoint
CREATE POLICY categories_write ON app.categories FOR ALL TO lukas_app
  USING (user_id = app.current_user_id())
  WITH CHECK (
    user_id = app.current_user_id()
    AND (household_id IS NULL OR household_id IN (SELECT app.my_household_ids()))
  );
--> statement-breakpoint
ALTER TABLE app.transactions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY transactions_read ON app.transactions FOR SELECT TO lukas_app
  USING (user_id = app.current_user_id() OR household_id IN (SELECT app.my_household_ids()));
--> statement-breakpoint
CREATE POLICY transactions_write ON app.transactions FOR ALL TO lukas_app
  USING (user_id = app.current_user_id())
  WITH CHECK (
    user_id = app.current_user_id()
    AND (household_id IS NULL OR household_id IN (SELECT app.my_household_ids()))
  );
--> statement-breakpoint
-- Los asientos siguen a su transacción: se ven si la transacción se ve (la subconsulta ya pasa
-- por la política de transactions).
ALTER TABLE app.entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY entries_read ON app.entries FOR SELECT TO lukas_app
  USING (
    user_id = app.current_user_id()
    OR EXISTS (SELECT 1 FROM app.transactions t WHERE t.id = transaction_id)
  );
--> statement-breakpoint
CREATE POLICY entries_write ON app.entries FOR ALL TO lukas_app
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());
--> statement-breakpoint
ALTER TABLE app.changes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY changes_own ON app.changes FOR ALL TO lukas_app
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());
--> statement-breakpoint
ALTER TABLE app.idempotency_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY idempotency_keys_own ON app.idempotency_keys FOR ALL TO lukas_app
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());
--> statement-breakpoint
ALTER TABLE app.audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_log_own ON app.audit_log FOR SELECT TO lukas_app
  USING (user_id = app.current_user_id());
--> statement-breakpoint
-- La bandeja de salida es interna del servidor: RLS sin políticas y sin permisos para la app.
ALTER TABLE app.outbox ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app.households ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY households_read ON app.households FOR SELECT TO lukas_app
  USING (id IN (SELECT app.my_household_ids()) OR created_by = app.current_user_id());
--> statement-breakpoint
CREATE POLICY households_create ON app.households FOR INSERT TO lukas_app
  WITH CHECK (created_by = app.current_user_id());
--> statement-breakpoint
CREATE POLICY households_update ON app.households FOR UPDATE TO lukas_app
  USING (app.is_household_owner(id))
  WITH CHECK (app.is_household_owner(id));
--> statement-breakpoint
CREATE POLICY households_delete ON app.households FOR DELETE TO lukas_app
  USING (app.is_household_owner(id));
--> statement-breakpoint
ALTER TABLE app.household_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY household_members_read ON app.household_members FOR SELECT TO lukas_app
  USING (household_id IN (SELECT app.my_household_ids()));
--> statement-breakpoint
-- Agrega miembros quien es dueño del hogar; quien lo crea se agrega a sí mismo como dueño.
CREATE POLICY household_members_add ON app.household_members FOR INSERT TO lukas_app
  WITH CHECK (
    app.is_household_owner(household_id)
    OR (
      user_id = app.current_user_id() AND role = 'owner' AND app.created_household(household_id)
    )
  );
--> statement-breakpoint
CREATE POLICY household_members_update ON app.household_members FOR UPDATE TO lukas_app
  USING (app.is_household_owner(household_id))
  WITH CHECK (app.is_household_owner(household_id));
--> statement-breakpoint
-- Sale del hogar uno mismo, o lo saca el dueño.
CREATE POLICY household_members_remove ON app.household_members FOR DELETE TO lukas_app
  USING (user_id = app.current_user_id() OR app.is_household_owner(household_id));
--> statement-breakpoint

-- 4. Auditoría de accesos: cada escritura en datos del usuario y en hogares queda en audit_log
--    con quién la hizo y de quién era el registro. La app no puede escribir la bitácora
--    directamente (solo por estas funciones) ni leer la de otros.
CREATE FUNCTION app.audit_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, app
AS $$
DECLARE
  r jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  actor_id text := app.current_user_id();
  owner_id text := coalesce(r->>'user_id', r->>'created_by');
BEGIN
  INSERT INTO app.audit_log (user_id, actor, action, entity, entity_id, metadata)
  VALUES (
    coalesce(actor_id, owner_id),
    CASE WHEN actor_id IS NULL THEN 'system' ELSE 'user' END,
    lower(TG_OP),
    TG_TABLE_NAME,
    coalesce(r->>'id', (r->>'household_id') || ':' || (r->>'user_id')),
    CASE WHEN owner_id IS DISTINCT FROM actor_id THEN jsonb_build_object('owner', owner_id) END
  );
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER accounts_audit AFTER INSERT OR UPDATE OR DELETE ON app.accounts
FOR EACH ROW EXECUTE FUNCTION app.audit_change();
--> statement-breakpoint
CREATE TRIGGER categories_audit AFTER INSERT OR UPDATE OR DELETE ON app.categories
FOR EACH ROW EXECUTE FUNCTION app.audit_change();
--> statement-breakpoint
CREATE TRIGGER transactions_audit AFTER INSERT OR UPDATE OR DELETE ON app.transactions
FOR EACH ROW EXECUTE FUNCTION app.audit_change();
--> statement-breakpoint
CREATE TRIGGER households_audit AFTER INSERT OR UPDATE OR DELETE ON app.households
FOR EACH ROW EXECUTE FUNCTION app.audit_change();
--> statement-breakpoint
CREATE TRIGGER household_members_audit AFTER INSERT OR UPDATE OR DELETE ON app.household_members
FOR EACH ROW EXECUTE FUNCTION app.audit_change();
--> statement-breakpoint
-- Para accesos que no son escrituras (exportar, ver un reporte compartido, iniciar sesión).
-- El usuario sale de la sesión: no se puede registrar a nombre de otro.
CREATE FUNCTION app.audit(action text, entity text, entity_id text, metadata jsonb DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, app
AS $$
BEGIN
  IF app.current_user_id() IS NULL THEN
    RAISE EXCEPTION 'Sin usuario en la sesión' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO app.audit_log (user_id, actor, action, entity, entity_id, metadata)
  VALUES (app.current_user_id(), 'user', action, entity, entity_id, metadata);
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.audit(text, text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.audit(text, text, text, jsonb) TO lukas_app;
