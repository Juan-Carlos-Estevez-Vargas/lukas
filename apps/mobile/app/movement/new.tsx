import { type Account, type MovementKind, parseTags } from "@lukas/domain";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import { civilDate } from "../../src/accounts/credit-card";
import { accountErrorKey } from "../../src/accounts/messages";
import { assistantEnabled } from "../../src/assistant/settings";
import { useSession } from "../../src/auth/session";
import { useBudgetAlerts } from "../../src/budgets/use-budget-alerts";
import { Chip, ChipRow, Keypad } from "../../src/components/quick";
import { Body, Button, Field, Screen, Toggle } from "../../src/components/ui";
import { apiUrl, e2eMode } from "../../src/config";
import { newId } from "../../src/data/ids";
import { sqliteAccounts } from "../../src/data/ledger-sqlite";
import { useLocalDatabase } from "../../src/data/provider";
import { formatCivilDate } from "../../src/format/date";
import { formatMoney } from "../../src/format/money";
import type { MessageKey } from "../../src/i18n/es";
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
import { recentTags } from "../../src/movements/tags";
import { compressForReading } from "../../src/receipts/compress";
import { pickReceipt, type ReceiptSource } from "../../src/receipts/pick";
import {
  createReceiptReader,
  e2eReceiptReader,
  patchFromReading,
  type ReadError,
} from "../../src/receipts/reading";
import { receiptStore } from "../../src/receipts/receipt-store";
import type { StoredReceipt } from "../../src/receipts/store";
import { useCardReminders } from "../../src/reminders/use-card-reminders";
import { useTheme } from "../../src/theme/theme";

const DAYS = [0, 1, 2] as const;

const READ_ERRORS: Record<ReadError["kind"], MessageKey> = {
  signed_out: "assistant.error.signedOut",
  quota: "assistant.error.quota",
  unreadable: "receipt.read.unreadable",
  unavailable: "assistant.error.unavailable",
  network: "assistant.error.network",
  unexpected: "assistant.error.unexpected",
};

const reader = e2eMode ? e2eReceiptReader() : createReceiptReader(apiUrl);

/**
 * Registro rápido: monto con el teclado propio, comercio con autocompletar y categoría sugerida.
 * Cuenta (la última usada) y fecha (hoy) ya vienen puestas, así que un gasto son tres toques.
 */
export default function NewMovement() {
  const { t, locale } = useI18n();
  const { colors, fontSize, fontWeight } = useTheme();
  const database = useLocalDatabase();
  const reminders = useCardReminders();
  const budgets = useBudgetAlerts();
  // Los widgets abren esta pantalla con `?kind=…&category=…` para registrar más rápido; el
  // asistente ("Editar" en una propuesta) además manda cuenta, monto en pesos, comercio y nota.
  const params = useLocalSearchParams<{
    kind?: string;
    category?: string;
    account?: string;
    amount?: string;
    merchant?: string;
    note?: string;
  }>();
  const [kind, setKind] = useState<MovementKind>(params.kind === "income" ? "income" : "expense");
  const [digits, setDigits] = useState(() =>
    /^\d{1,13}$/.test(params.amount ?? "") ? (params.amount ?? "").replace(/^0+/, "") : "",
  );
  const [merchant, setMerchant] = useState(params.merchant?.slice(0, 80) ?? "");
  const [merchants, setMerchants] = useState<string[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [suggestedId, setSuggestedId] = useState<string | null>(null);
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [daysAgo, setDaysAgo] = useState(0);
  // Fecha más vieja que anteayer, cuando la trae un recibo leído.
  const [otherDate, setOtherDate] = useState<Date | null>(null);
  const [canRead, setCanRead] = useState(false);
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState<MessageKey | null>(null);
  const { state: session } = useSession();
  const [note, setNote] = useState(params.note?.slice(0, 200) ?? "");
  const [split, setSplit] = useState(false);
  const [parts, setParts] = useState<Record<string, string>>({});
  const [tagsText, setTagsText] = useState("");
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [receipt, setReceipt] = useState<StoredReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const db = database.status === "ready" ? database.db : null;

  useEffect(() => {
    if (!db) return;
    const wanted = params.account;
    void sqliteAccounts(db)
      .list()
      .then((list) => {
        setAccounts(list);
        if (wanted && list.some((a) => a.id === wanted && !a.archivedAt)) setAccountId(wanted);
        else void defaultAccountId(db).then(setAccountId);
      });
    void recentTags(db).then(setKnownTags);
    // Leer recibos usa el asistente: solo si la persona lo encendió.
    void assistantEnabled(db).then(setCanRead);
  }, [db, params.account]);

  useEffect(() => {
    if (!db) return;
    setCategoryId(null);
    setCategoryTouched(false);
    setParts({});
    void listCategories(db, kind, new Date()).then((list) => {
      setCategories(list);
      const wanted = params.category;
      if (wanted && list.some((c) => c.id === wanted)) {
        setCategoryId(wanted);
        setCategoryTouched(true);
      }
    });
  }, [db, kind, params.category]);

  useEffect(() => {
    if (!db) return;
    let active = true;
    void Promise.all([
      merchantSuggestions(db, merchant),
      categoryTouched ? Promise.resolve(null) : suggestCategory(db, merchant, kind),
    ]).then(([names, suggested]) => {
      if (!active) return;
      setMerchants(names);
      if (categoryTouched) return;
      setSuggestedId(suggested);
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

  const splitParts = Object.entries(parts).map(([id, text]) => ({
    categoryId: id,
    amount: keypadAmount(text.replace(/\D/g, "")),
  }));
  const assigned = splitParts.reduce((sum, p) => sum.add(p.amount), keypadAmount(""));
  const remaining = amount.subtract(assigned);

  const attach = async (source: ReceiptSource) => {
    try {
      const picked = await pickReceipt(source);
      if (!picked) return;
      if (receipt) await receiptStore.remove(receipt.fileName);
      setReceipt(await receiptStore.save(picked.uri, picked.mimeType));
    } catch {
      setError(t("movement.error.receipt"));
    }
  };

  const readReceipt = async () => {
    if (!receipt || session.status !== "signedIn") return;
    setReading(true);
    setReadNote(null);
    try {
      const image = await compressForReading(receiptStore.uriOf(receipt.fileName));
      const res = await reader.read(session.token, image);
      if (!res.ok) return setReadNote(READ_ERRORS[res.error.kind]);
      const patch = patchFromReading(res.value, new Date());
      if (patch.digits) setDigits(patch.digits);
      if (patch.merchant) setMerchant(patch.merchant);
      if (patch.daysAgo !== undefined) {
        setDaysAgo(patch.daysAgo);
        setOtherDate(null);
      }
      if (patch.date) setOtherDate(patch.date);
      setReadNote("receipt.read.review");
    } catch {
      setReadNote("receipt.read.unreadable");
    } finally {
      setReading(false);
    }
  };

  const cancel = () => {
    if (receipt) void receiptStore.remove(receipt.fileName);
    router.back();
  };

  const save = async () => {
    if (amount.isZero()) return setError(t("movement.error.amount"));
    if (split && (splitParts.length < 2 || !remaining.isZero())) {
      return setError(t("movement.error.split"));
    }
    if (!split && !categoryId) return setError(t("movement.error.category"));
    if (!accountId) return setError(t("movement.error.account"));
    setBusy(true);
    setError(null);
    try {
      const res = await recordMovement(
        db,
        {
          kind,
          accountId,
          categoryId: categoryId ?? "",
          splits: split ? splitParts : [],
          amount,
          tags: parseTags(tagsText),
          // Solo hay corrección que aprender si hubo comercio y una sugerencia (o ninguna).
          ...(merchant.trim() ? { suggestedCategoryId: suggestedId } : {}),
          receipt,
          occurredAt: otherDate ?? occurredAtFor(daysAgo, new Date()),
          merchant,
          note,
        },
        { newId, now: () => new Date() },
      );
      if (!res.ok) return setError(t(accountErrorKey(res.error)));
      if (account?.type === "credit_card") reminders.resync();
      budgets.check();
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
          <Chip
            label={t("movement.transfer")}
            onPress={() => router.replace("/movement/transfer")}
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
          testID="movement-merchant"
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

        <Toggle label={t("movement.split")} value={split} onChange={setSplit} />
        <Body muted>{t("movement.category")}</Body>
        <ChipRow testID="movement-categories">
          {categories.map((c) => (
            <Chip
              key={c.id}
              label={c.icon ? `${c.icon} ${c.name}` : c.name}
              selected={split ? c.id in parts : c.id === categoryId}
              onPress={() => {
                setCategoryTouched(true);
                if (!split) return setCategoryId(c.id);
                setParts(({ [c.id]: current, ...rest }) =>
                  current === undefined ? { ...rest, [c.id]: "" } : rest,
                );
              }}
            />
          ))}
        </ChipRow>
        {split
          ? categories
              .filter((c) => c.id in parts)
              .map((c) => (
                <Field
                  key={c.id}
                  label={c.name}
                  value={parts[c.id] ?? ""}
                  onChangeText={(v) => setParts((p) => ({ ...p, [c.id]: v }))}
                  keyboardType="number-pad"
                />
              ))
          : null}
        {split ? (
          <Body muted>
            {t("movement.remaining", { amount: formatMoney(remaining, { locale }) })}
          </Body>
        ) : null}

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
              selected={!otherDate && daysAgo === d}
              onPress={() => {
                setDaysAgo(d);
                setOtherDate(null);
              }}
            />
          ))}
          {otherDate ? (
            <Chip
              label={formatCivilDate(civilDate(otherDate), locale)}
              selected
              onPress={() => {}}
            />
          ) : null}
        </ChipRow>
        <Field label={t("movement.note")} value={note} onChangeText={setNote} />
        <Field
          label={t("movement.tags")}
          value={tagsText}
          onChangeText={setTagsText}
          autoCapitalize="none"
        />
        {knownTags.length > 0 ? (
          <ChipRow>
            {knownTags.map((tag) => (
              <Chip
                key={tag}
                label={`#${tag}`}
                onPress={() =>
                  setTagsText((text) => (text.trim() ? `${text.trim()}, ${tag}` : tag))
                }
              />
            ))}
          </ChipRow>
        ) : null}
        {receiptStore.available ? (
          receipt ? (
            <>
              <Body>{t("movement.receipt.attached")}</Body>
              {canRead ? (
                <Button
                  label={t("receipt.read")}
                  busy={reading}
                  onPress={() => void readReceipt()}
                />
              ) : null}
              {readNote === "receipt.read.review" ? <Body>{t(readNote)}</Body> : null}
              {readNote && readNote !== "receipt.read.review" ? (
                <Body tone="error">{t(readNote)}</Body>
              ) : null}
              <Button
                label={t("movement.receipt.remove")}
                variant="plain"
                onPress={() => {
                  void receiptStore.remove(receipt.fileName);
                  setReceipt(null);
                }}
              />
            </>
          ) : (
            <ChipRow>
              <Chip label={t("movement.receipt.camera")} onPress={() => void attach("camera")} />
              <Chip label={t("movement.receipt.library")} onPress={() => void attach("library")} />
            </ChipRow>
          )
        ) : null}

        {error ? <Body tone="error">{error}</Body> : null}
        <Button label={t("movement.save")} busy={busy} onPress={() => void save()} />
        <Button label={t("lock.cancel")} variant="plain" onPress={cancel} />
      </ScrollView>
    </Screen>
  );
}
