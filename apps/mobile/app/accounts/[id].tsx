import type { Account, AccountChanges, CardSummary, Money } from "@lukas/domain";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView } from "react-native";
import { editAccount, setArchived } from "../../src/accounts/accounts";
import { cardSummary, civilDate, parseDay } from "../../src/accounts/credit-card";
import { accountErrorKey } from "../../src/accounts/messages";
import { parsePesos } from "../../src/accounts/parse";
import { Body, Button, Field, Loading, Screen, Title, Toggle } from "../../src/components/ui";
import { sqliteAccounts } from "../../src/data/ledger-sqlite";
import { useLocalDatabase } from "../../src/data/provider";
import { useDiscreet } from "../../src/display/discreet";
import { formatCivilDate } from "../../src/format/date";
import { formatMoney } from "../../src/format/money";
import { useI18n } from "../../src/i18n/i18n";
import { useCardReminders } from "../../src/reminders/use-card-reminders";

const pesos = (m: Money | null) => (m ? String(m.amountMinor / 100n) : "");
const dayText = (d: number | null) => (d === null ? "" : String(d));

export default function EditAccount() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const { discreet } = useDiscreet();
  const database = useLocalDatabase();
  const reminders = useCardReminders();
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [balance, setBalance] = useState<Money | null>(null);
  const [summary, setSummary] = useState<CardSummary | null>(null);
  const [name, setName] = useState("");
  const [limit, setLimit] = useState("");
  const [closing, setClosing] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (database.status !== "ready" || !id) return;
    const repo = sqliteAccounts(database.db);
    const found = await repo.get(id);
    setAccount(found);
    if (!found) return;
    setName(found.name);
    setLimit(pesos(found.creditLimit));
    setClosing(dayText(found.closingDay));
    setDue(dayText(found.dueDay));
    setBalance(await repo.balance(found));
    if (found.type === "credit_card") {
      const res = await cardSummary(database.db, found, civilDate(new Date()));
      setSummary(res.ok ? res.value : null);
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

  const isCard = account.type === "credit_card";
  const money = (m: Money) => formatMoney(m, { locale, discreet });
  const date = (d: CardSummary["cycle"]["due"]) => formatCivilDate(d, locale);

  const run = async (action: () => ReturnType<typeof editAccount>, close: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await action();
      if (res && !res.ok) return setError(t(accountErrorKey(res.error)));
      if (isCard) reminders.resync();
      if (close) router.back();
      else await load();
    } catch {
      setError(t("accounts.error.generic"));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const changes: { -readonly [K in keyof AccountChanges]: AccountChanges[K] } = { name };
    if (isCard) {
      const creditLimit = parsePesos(limit);
      if (creditLimit === undefined || creditLimit?.isNegative()) {
        return setError(t("card.invalidAmount"));
      }
      const closingDay = parseDay(closing);
      const dueDay = parseDay(due);
      if (closingDay === undefined || dueDay === undefined) {
        return setError(t("accounts.error.invalid_day"));
      }
      Object.assign(changes, { creditLimit, closingDay, dueDay });
    }
    void run(() => editAccount(db, account.id, changes, new Date()), true);
  };

  const db = database.db;
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 16 }} keyboardShouldPersistTaps="handled">
        <Title>{t("accounts.edit.title")}</Title>
        {balance && !isCard ? (
          <Body muted>{t("accounts.balance", { amount: money(balance) })}</Body>
        ) : null}
        {isCard ? <CardSummaryView summary={summary} money={money} date={date} /> : null}
        {account.archivedAt ? <Body muted>{t("accounts.archivedNote")}</Body> : null}
        <Field label={t("accounts.editName")} value={name} onChangeText={setName} />
        {isCard ? (
          <>
            <Field
              label={t("card.limit")}
              value={limit}
              onChangeText={setLimit}
              keyboardType="number-pad"
            />
            <Field
              label={t("card.closingDay")}
              value={closing}
              onChangeText={setClosing}
              keyboardType="number-pad"
              maxLength={2}
            />
            <Field
              label={t("card.dueDay")}
              value={due}
              onChangeText={setDue}
              keyboardType="number-pad"
              maxLength={2}
            />
            {reminders.available ? (
              <Toggle
                label={t("card.reminders")}
                value={reminders.enabled}
                onChange={(on) =>
                  void reminders.setEnabled(on).then((ok) => {
                    if (!ok) setError(t("card.reminders.denied"));
                  })
                }
              />
            ) : null}
          </>
        ) : null}
        {error ? <Body tone="error">{error}</Body> : null}
        <Button label={t("accounts.save")} busy={busy} onPress={save} />
        <Button
          label={t(account.archivedAt ? "accounts.unarchive" : "accounts.archive")}
          variant="plain"
          onPress={() =>
            void run(() => setArchived(db, account.id, !account.archivedAt, new Date()), false)
          }
        />
        <Button label={t("lock.cancel")} variant="plain" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}

function CardSummaryView({
  summary,
  money,
  date,
}: {
  readonly summary: CardSummary | null;
  readonly money: (m: Money) => string;
  readonly date: (d: CardSummary["cycle"]["due"]) => string;
}) {
  const { t } = useI18n();
  if (!summary) return <Body muted>{t("card.summary.missingDays")}</Body>;
  const s = summary;
  const pending = !s.amountDue.isZero();
  return (
    <>
      <Body>{t("card.summary.debt", { amount: money(s.debt) })}</Body>
      {pending ? (
        <>
          <Body>{t("card.summary.due", { amount: money(s.amountDue) })}</Body>
          <Body>{t("card.summary.minimum", { amount: money(s.minimumPayment) })}</Body>
          {s.daysUntilDue < 0 ? (
            <Body tone="error">
              {t("card.summary.overdue", { date: date(s.lastStatement.due) })}
            </Body>
          ) : (
            <Body>{t("card.summary.dueDate", { date: date(s.lastStatement.due) })}</Body>
          )}
        </>
      ) : (
        <Body muted>{t("card.summary.paid")}</Body>
      )}
      <Body muted>
        {t("card.summary.charges", {
          date: date(s.cycle.closes),
          amount: money(s.chargesThisCycle),
        })}
      </Body>
      {s.available ? (
        <Body muted>{t("card.summary.available", { amount: money(s.available) })}</Body>
      ) : null}
      {pending ? <Body muted>{t("card.summary.minimumNote")}</Body> : null}
    </>
  );
}
