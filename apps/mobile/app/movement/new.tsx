import type { Account, MovementKind } from "@lukas/domain";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import { accountErrorKey } from "../../src/accounts/messages";
import { Chip, ChipRow, Keypad } from "../../src/components/quick";
import { Body, Button, Field, Screen } from "../../src/components/ui";
import { newId } from "../../src/data/ids";
import { sqliteAccounts } from "../../src/data/ledger-sqlite";
import { useLocalDatabase } from "../../src/data/provider";
import { formatMoney } from "../../src/format/money";
import { useI18n } from "../../src/i18n/i18n";
import { occurredAtFor } from "../../src/movements/dates";
import { keypadAmount, pressKey } from "../../src/movements/keypad";
import {
  type Category,
  defaultAccountId,
  listCategories,
  merchantSuggestions,
  recordMovement,
  suggestCategory,
} from "../../src/movements/movements";
import { useCardReminders } from "../../src/reminders/use-card-reminders";
import { useTheme } from "../../src/theme/theme";

const DAYS = [0, 1, 2] as const;

/**
 * Registro rápido: monto con el teclado propio, comercio con autocompletar y categoría sugerida.
 * Cuenta (la última usada) y fecha (hoy) ya vienen puestas, así que un gasto son tres toques.
 */
export default function NewMovement() {
  const { t, locale } = useI18n();
  const { colors, fontSize, fontWeight } = useTheme();
  const database = useLocalDatabase();
  const reminders = useCardReminders();
  const [kind, setKind] = useState<MovementKind>("expense");
  const [digits, setDigits] = useState("");
  const [merchant, setMerchant] = useState("");
  const [merchants, setMerchants] = useState<string[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [daysAgo, setDaysAgo] = useState(0);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const db = database.status === "ready" ? database.db : null;

  useEffect(() => {
    if (!db) return;
    void sqliteAccounts(db).list().then(setAccounts);
    void defaultAccountId(db).then(setAccountId);
  }, [db]);

  useEffect(() => {
    if (!db) return;
    setCategoryId(null);
    setCategoryTouched(false);
    void listCategories(db, kind, new Date()).then(setCategories);
  }, [db, kind]);

  useEffect(() => {
    if (!db) return;
    let active = true;
    void Promise.all([
      merchantSuggestions(db, merchant),
      categoryTouched ? Promise.resolve(null) : suggestCategory(db, merchant, kind),
    ]).then(([names, suggested]) => {
      if (!active) return;
      setMerchants(names);
      if (suggested) setCategoryId(suggested);
    });
    return () => {
      active = false;
    };
  }, [db, merchant, kind, categoryTouched]);

  if (!db) {
    return (
      <Screen>
        <Body muted>{t("summary.unavailable")}</Body>
      </Screen>
    );
  }

  const amount = keypadAmount(digits);
  const account = accounts.find((a) => a.id === accountId);

  const save = async () => {
    if (amount.isZero()) return setError(t("movement.error.amount"));
    if (!categoryId) return setError(t("movement.error.category"));
    if (!accountId) return setError(t("movement.error.account"));
    setBusy(true);
    setError(null);
    try {
      const res = await recordMovement(
        db,
        {
          kind,
          accountId,
          categoryId,
          amount,
          occurredAt: occurredAtFor(daysAgo, new Date()),
          merchant,
          note,
        },
        { newId, now: () => new Date() },
      );
      if (!res.ok) return setError(t(accountErrorKey(res.error)));
      if (account?.type === "credit_card") reminders.resync();
      router.back();
    } catch {
      setError(t("movement.error.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
        <ChipRow>
          <Chip
            label={t("movement.expense")}
            selected={kind === "expense"}
            onPress={() => setKind("expense")}
          />
          <Chip
            label={t("movement.income")}
            selected={kind === "income"}
            onPress={() => setKind("income")}
          />
        </ChipRow>
        <Text
          accessibilityLiveRegion="polite"
          style={{
            color: kind === "expense" ? colors.expense : colors.income,
            fontSize: fontSize.display,
            fontWeight: fontWeight.bold,
            textAlign: "right",
          }}
        >
          {/* Mientras se escribe el monto se muestra aunque esté activo el modo discreto. */}
          {formatMoney(amount, { locale })}
        </Text>
        <Keypad onKey={(k) => setDigits((d) => pressKey(d, k))} backLabel={t("movement.erase")} />

        <Field
          label={t("movement.merchant")}
          value={merchant}
          onChangeText={setMerchant}
          autoCapitalize="words"
          autoCorrect={false}
        />
        {merchants.length > 0 ? (
          <ChipRow>
            {merchants.map((m) => (
              <Chip key={m} label={m} onPress={() => setMerchant(m)} />
            ))}
          </ChipRow>
        ) : null}

        <Body muted>{t("movement.category")}</Body>
        <ChipRow>
          {categories.map((c) => (
            <Chip
              key={c.id}
              label={c.icon ? `${c.icon} ${c.name}` : c.name}
              selected={c.id === categoryId}
              onPress={() => {
                setCategoryTouched(true);
                setCategoryId(c.id);
              }}
            />
          ))}
        </ChipRow>

        <Body muted>{t("movement.account")}</Body>
        {accounts.length === 0 ? <Body>{t("movement.noAccounts")}</Body> : null}
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
        <Field label={t("movement.note")} value={note} onChangeText={setNote} />

        {error ? <Body tone="error">{error}</Body> : null}
        <Button label={t("movement.save")} busy={busy} onPress={() => void save()} />
        <Button label={t("lock.cancel")} variant="plain" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}
