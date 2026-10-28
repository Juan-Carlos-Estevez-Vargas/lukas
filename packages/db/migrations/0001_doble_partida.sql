-- Reglas de integridad del libro mayor que no se pueden expresar con CHECK.

-- 1. Cada transacción debe tener al menos dos asientos y, por cada moneda, sumar cero.
--    Se verifica al hacer COMMIT (trigger diferido) para permitir insertar los asientos uno a uno.
CREATE FUNCTION app.assert_transaction_balanced(tx_id uuid) RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
DECLARE
  entry_count integer;
  unbalanced_currency char(3);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.transactions WHERE id = tx_id) THEN
    RETURN; -- la transacción se borró en cascada
  END IF;

  SELECT count(*) INTO entry_count FROM app.entries WHERE transaction_id = tx_id;
  IF entry_count < 2 THEN
    RAISE EXCEPTION 'La transacción % necesita al menos dos asientos (tiene %)', tx_id, entry_count
      USING ERRCODE = 'check_violation', CONSTRAINT = 'transaction_min_entries';
  END IF;

  SELECT currency INTO unbalanced_currency
  FROM app.entries
  WHERE transaction_id = tx_id
  GROUP BY currency
  HAVING sum(amount_minor) <> 0
  LIMIT 1;

  IF unbalanced_currency IS NOT NULL THEN
    RAISE EXCEPTION 'Los asientos de la transacción % no suman cero en %', tx_id, unbalanced_currency
      USING ERRCODE = 'check_violation', CONSTRAINT = 'transaction_balanced';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.entries_check_balance() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM app.assert_transaction_balanced(NEW.transaction_id);
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM app.assert_transaction_balanced(OLD.transaction_id);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER entries_balanced
AFTER INSERT OR UPDATE OR DELETE ON app.entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app.entries_check_balance();
--> statement-breakpoint
CREATE FUNCTION app.transactions_check_balance() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
BEGIN
  PERFORM app.assert_transaction_balanced(NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER transactions_balanced
AFTER INSERT ON app.transactions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app.transactions_check_balance();
--> statement-breakpoint

-- 2. Un asiento solo puede tocar cuentas y categorías del mismo usuario de la transacción,
--    y en la moneda de la cuenta.
CREATE FUNCTION app.entries_check_ownership() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, app
AS $$
DECLARE
  account_user text;
  account_currency char(3);
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app.transactions WHERE id = NEW.transaction_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'El asiento no pertenece al dueño de la transacción'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'entry_same_owner';
  END IF;

  IF NEW.account_id IS NOT NULL THEN
    SELECT user_id, currency INTO account_user, account_currency
    FROM app.accounts WHERE id = NEW.account_id;
    IF account_user IS DISTINCT FROM NEW.user_id THEN
      RAISE EXCEPTION 'La cuenta no pertenece al usuario'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'entry_same_owner';
    END IF;
    IF account_currency <> NEW.currency THEN
      RAISE EXCEPTION 'La moneda del asiento (%) no coincide con la de la cuenta (%)',
        NEW.currency, account_currency
        USING ERRCODE = 'check_violation', CONSTRAINT = 'entry_account_currency';
    END IF;
  END IF;

  IF NEW.category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM app.categories WHERE id = NEW.category_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'La categoría no pertenece al usuario'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'entry_same_owner';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER entries_ownership
BEFORE INSERT OR UPDATE ON app.entries
FOR EACH ROW EXECUTE FUNCTION app.entries_check_ownership();
--> statement-breakpoint

-- 3. La bitácora de auditoría es de solo inserción.
CREATE FUNCTION app.audit_log_immutable() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log es de solo inserción'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update
BEFORE UPDATE OR DELETE ON app.audit_log
FOR EACH ROW EXECUTE FUNCTION app.audit_log_immutable();
