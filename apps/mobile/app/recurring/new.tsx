import { type Account, FREQUENCIES, type Frequency, type MovementKind } from "@lukas/domain";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView } from "react-native";
import { civilDate } from "../../src/accounts/credit-card";
import { accountErrorKey } from "../../src/accounts/messages";
import { parseAmount } from "../../src/accounts/parse";
import { Chip, ChipRow } from "../../src/components/quick";
import { Body, Button, Field, Screen, Title, Toggle } from "../../src/components/ui";
import { newId } from "../../src/data/ids";
import { sqliteAccounts } from "../../src/data/ledger-sqlite";
import { useLocalDatabase } from "../../src/data/provider";
import { useI18n } from "../../src/i18n/i18n";
import { type Category, defaultAccountId, listCategories } from "../../src/movements/movements";
import { civilKey, createRecurring, parseCivil } from "../../src/recurring/recurring";
import { useRecurring } from "../../src/recurring/use-recurring";
import { notificationScheduler } from "../../src/reminders/notifications";

/** Nuevo recurrente: qué, cuánto, de qué cuenta y cada cuánto. */
export default function NewRecurring() {
  const { t } = useI18n();
  const database = useLocalDatabase();
  const recurring = useRecurring();
  const db = database.status === "ready" ? database.db : null;
  const [kind, setKind] = useState<MovementKind>("expense");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [every, setEvery] = useState("1");
  const [startsOn, setStartsOn] = useState(() => civilKey(civilDate(new Date())));
  const [endsOn, setEndsOn] = useState("");
  const [autoPost, setAutoPost] = useState(true);
  const [remind, setRemind] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!db) return;
    void sqliteAccounts(db).list().then(setAccounts);
    void defaultAccountId(db).then(setAccountId);
  }, [db]);

  useEffect(() => {
    if (!db) return;
    setCategoryId(null);
    void listCategories(db, kind, new Date()).then(setCategories);
  }, [db, kind]);

  if (!db) {
    return (
      <Screen>
        <Body muted>{t("summary.unavailable")}</Body>
      </Screen>
    );
  }

  const save = async () => {
    if (busy) return;
    setError(null);
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return setError(t("movement.error.account"));
    if (!categoryId) return setError(t("movement.error.category"));
    const money = parseAmount(amount, account.currency);
    if (!money) return setError(t("movement.error.amount"));
    const start = parseCivil(startsOn);
    const end = endsOn.trim() ? parseCivil(endsOn) : null;
    if (!start || (endsOn.trim() && !end)) return setError(t("accounts.error.invalid_date"));
    setBusy(true);
    try {
      const now = new Date();
      const res = await createRecurring(
        db,
        {
          name,
          kind,
          accountId: account.id,
          categoryId,
          amount: money,
          recurrence: { frequency, every: Number(every), startsOn: start, endsOn: end },
          autoPost,
          remind,
        },
        civilDate(now),
        { newId, now: () => now },
      );
      if (!res.ok) return setError(t(accountErrorKey(res.error)));
      if (remind && notificationScheduler.available) {
        await notificationScheduler.ensurePermission();
      }
      recurring.refresh();
      router.back();
    } catch {
      setError(t("accounts.error.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
        <Title>{t("recurring.new")}</Title>
        <ChipRow>
          <Chip
            label={t("list.kind.expense")}
            selected={kind === "expense"}
            onPress={() => setKind("expense")}
          />
          <Chip
            label={t("list.kind.income")}
            selected={kind === "income"}
            onPress={() => setKind("income")}
          />
        </ChipRow>
        <Field
          label={t("recurring.name")}
          value={name}
          onChangeText={setName}
          placeholder="Arriendo"
        />
        <Field
          label={t("recurring.amount")}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="1.200.000"
        />

        <Body muted>{t("movement.account")}</Body>
        <ChipRow>
          {accounts.map((a) => (
            <Chip
              key={a.id}
              label={a.name}
              selected={a.id === accountId}
              onPress={() => setAccountId(a.id)}
            />
          ))}
        </ChipRow>
        <Body muted>{t("movement.category")}</Body>
        <ChipRow>
          {categories.map((c) => (
            <Chip
              key={c.id}
              label={c.icon ? `${c.icon} ${c.name}` : c.name}
              selected={c.id === categoryId}
              onPress={() => setCategoryId(c.id)}
            />
          ))}
        </ChipRow>

        <ChipRow>
          {FREQUENCIES.map((f) => (
            <Chip
              key={f}
              label={t(`recurring.freq.${f}`)}
              selected={f === frequency}
              onPress={() => setFrequency(f)}
            />
          ))}
        </ChipRow>
        <Field
          label={t("recurring.every")}
          value={every}
          onChangeText={setEvery}
          keyboardType="number-pad"
          maxLength={3}
        />
        <Field label={t("recurring.startsOn")} value={startsOn} onChangeText={setStartsOn} />
        <Field
          label={t("recurring.endsOn")}
          value={endsOn}
          onChangeText={setEndsOn}
          placeholder="2027-12-31"
        />
        <Toggle label={t("recurring.autoPost")} value={autoPost} onChange={setAutoPost} />
        {notificationScheduler.available ? (
          <Toggle label={t("recurring.remind")} value={remind} onChange={setRemind} />
        ) : null}

        {error ? <Body tone="error">{error}</Body> : null}
        <Button label={t("recurring.create")} busy={busy} onPress={() => void save()} />
        <Button label={t("lock.cancel")} variant="plain" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}
