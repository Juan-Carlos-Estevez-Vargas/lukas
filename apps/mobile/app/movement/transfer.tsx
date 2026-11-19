import type { Account } from "@lukas/domain";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView } from "react-native";
import { accountErrorKey } from "../../src/accounts/messages";
import { parseAmount } from "../../src/accounts/parse";
import { Chip, ChipRow } from "../../src/components/quick";
import { Body, Button, Field, Screen, Title } from "../../src/components/ui";
import { newId } from "../../src/data/ids";
import { sqliteAccounts } from "../../src/data/ledger-sqlite";
import { useLocalDatabase } from "../../src/data/provider";
import { useI18n } from "../../src/i18n/i18n";
import { occurredAtFor } from "../../src/movements/dates";
import { recordTransfer } from "../../src/movements/transfers";
import { useCardReminders } from "../../src/reminders/use-card-reminders";

const DAYS = [0, 1, 2] as const;

/** Mover plata entre cuentas propias: pagar la tarjeta, pasar de Nequi al banco, cambiar dólares. */
export default function NewTransfer() {
  const { t } = useI18n();
  const database = useLocalDatabase();
  const reminders = useCardReminders();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [received, setReceived] = useState("");
  const [fee, setFee] = useState("");
  const [daysAgo, setDaysAgo] = useState(0);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const db = database.status === "ready" ? database.db : null;
  useEffect(() => {
    if (db) void sqliteAccounts(db).list().then(setAccounts);
  }, [db]);

  if (!db) {
    return (
      <Screen>
        <Body muted>{t("summary.unavailable")}</Body>
      </Screen>
    );
  }

  const from = accounts.find((a) => a.id === fromId);
  const to = accounts.find((a) => a.id === toId);
  const crossCurrency = Boolean(from && to && from.currency !== to.currency);

  const save = async () => {
    if (!from || !to) return setError(t("transfer.error.accounts"));
    const sent = parseAmount(amount, from.currency);
    const got = crossCurrency ? parseAmount(received, to.currency) : null;
    const charged = parseAmount(fee, from.currency);
    if (!sent || sent.isNegative() || got === undefined || charged === undefined) {
      return setError(t("transfer.error.amount"));
    }
    if (crossCurrency && !got) return setError(t("transfer.error.received"));
    setBusy(true);
    setError(null);
    try {
      const res = await recordTransfer(
        db,
        {
          fromAccountId: from.id,
          toAccountId: to.id,
          amount: sent,
          received: got,
          fee: charged,
          occurredAt: occurredAtFor(daysAgo, new Date()),
          description,
        },
        { newId, now: () => new Date() },
      );
      if (!res.ok) return setError(t(accountErrorKey(res.error)));
      if (from.type === "credit_card" || to.type === "credit_card") reminders.resync();
      router.back();
    } catch {
      setError(t("movement.error.generic"));
    } finally {
      setBusy(false);
    }
  };

  const accountChips = (selected: string | null, onPick: (id: string) => void) => (
    <ChipRow>
      {accounts.map((a) => (
        <Chip
          key={a.id}
          label={a.currency === "COP" ? a.name : `${a.name} (${a.currency})`}
          selected={a.id === selected}
          onPress={() => onPick(a.id)}
        />
      ))}
    </ChipRow>
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
        <Title>{t("transfer.title")}</Title>
        <Body muted>{t("transfer.from")}</Body>
        {accountChips(fromId, setFromId)}
        <Body muted>{t("transfer.to")}</Body>
        {accountChips(toId, setToId)}
        <Field
          label={t("transfer.amount", { currency: from?.currency ?? "COP" })}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
        />
        {crossCurrency && to ? (
          <Field
            label={t("transfer.received", { currency: to.currency })}
            value={received}
            onChangeText={setReceived}
            keyboardType="decimal-pad"
          />
        ) : null}
        <Field
          label={t("transfer.fee")}
          value={fee}
          onChangeText={setFee}
          keyboardType="decimal-pad"
        />
        <ChipRow>
          {DAYS.map((d) => (
            <Chip
              key={d}
              label={t(`movement.day.${d}`)}
              selected={daysAgo === d}
              onPress={() => setDaysAgo(d)}
            />
          ))}
        </ChipRow>
        <Field label={t("movement.note")} value={description} onChangeText={setDescription} />
        {error ? <Body tone="error">{error}</Body> : null}
        <Button label={t("movement.save")} busy={busy} onPress={() => void save()} />
        <Button label={t("lock.cancel")} variant="plain" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}
