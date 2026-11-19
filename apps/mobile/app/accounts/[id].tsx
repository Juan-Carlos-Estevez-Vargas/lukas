import type { Account, Money } from "@lukas/domain";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { editAccount, setArchived } from "../../src/accounts/accounts";
import { accountErrorKey } from "../../src/accounts/messages";
import { Body, Button, Field, Loading, Screen, Title } from "../../src/components/ui";
import { sqliteAccounts } from "../../src/data/ledger-sqlite";
import { useLocalDatabase } from "../../src/data/provider";
import { useDiscreet } from "../../src/display/discreet";
import { formatMoney } from "../../src/format/money";
import { useI18n } from "../../src/i18n/i18n";

export default function EditAccount() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const { discreet } = useDiscreet();
  const database = useLocalDatabase();
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [balance, setBalance] = useState<Money | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (database.status !== "ready" || !id) return;
    const repo = sqliteAccounts(database.db);
    const found = await repo.get(id);
    setAccount(found);
    if (found) {
      setName(found.name);
      setBalance(await repo.balance(found));
    }
  }, [database, id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (account === undefined) return <Loading />;
  if (account === null || database.status !== "ready") {
    return (
      <Screen>
        <Body>{t("accounts.notFound")}</Body>
        <Button label={t("lock.cancel")} variant="plain" onPress={() => router.back()} />
      </Screen>
    );
  }

  const run = async (action: () => ReturnType<typeof editAccount>, close: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await action();
      if (res && !res.ok) return setError(t(accountErrorKey(res.error)));
      if (close) router.back();
      else await load();
    } catch {
      setError(t("accounts.error.generic"));
    } finally {
      setBusy(false);
    }
  };

  const db = database.db;
  return (
    <Screen>
      <Title>{t("accounts.edit.title")}</Title>
      {balance ? (
        <Body muted>
          {t("accounts.balance", { amount: formatMoney(balance, { locale, discreet }) })}
        </Body>
      ) : null}
      {account.archivedAt ? <Body muted>{t("accounts.archivedNote")}</Body> : null}
      <Field label={t("accounts.editName")} value={name} onChangeText={setName} />
      {error ? <Body tone="error">{error}</Body> : null}
      <Button
        label={t("accounts.save")}
        busy={busy}
        onPress={() => void run(() => editAccount(db, account.id, { name }, new Date()), true)}
      />
      <Button
        label={t(account.archivedAt ? "accounts.unarchive" : "accounts.archive")}
        variant="plain"
        onPress={() =>
          void run(() => setArchived(db, account.id, !account.archivedAt, new Date()), false)
        }
      />
      <Button label={t("lock.cancel")} variant="plain" onPress={() => router.back()} />
    </Screen>
  );
}
