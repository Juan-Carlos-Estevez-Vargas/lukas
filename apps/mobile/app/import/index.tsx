import type { Account } from "@lukas/domain";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Chip, ChipRow } from "../../src/components/quick";
import { Body, Button, Field, Screen, Title } from "../../src/components/ui";
import { newId } from "../../src/data/ids";
import { sqliteAccounts } from "../../src/data/ledger-sqlite";
import { sqlitePreferences } from "../../src/data/preferences";
import { useLocalDatabase } from "../../src/data/provider";
import { useDiscreet } from "../../src/display/discreet";
import { formatCivilDate } from "../../src/format/date";
import { formatMoney } from "../../src/format/money";
import type { MessageKey } from "../../src/i18n/es";
import { useI18n } from "../../src/i18n/i18n";
import { type ColumnMap, type DateOrder, guessColumns, readRows } from "../../src/import/columns";
import { pickTableFile } from "../../src/import/files";
import {
  applyImport,
  defaultSelection,
  type ImportPlan,
  planImport,
  type RowStatus,
} from "../../src/import/import";
import { BANK_NAMES } from "../../src/import/statements/parse";
import { looksLikePdf, readRate, readStatement } from "../../src/import/statements/statement";
import { readTable, type Table } from "../../src/import/table";
import { todayCivil } from "../../src/projection/projection";
import { useSync } from "../../src/sync/use-sync";
import { useTheme } from "../../src/theme/theme";

type MapField = Exclude<keyof ColumnMap, "headerRow">;
const FIELDS: readonly MapField[] = [
  "date",
  "description",
  "amount",
  "debit",
  "credit",
  "category",
];
/** Filas que se muestran en la vista previa; el resto se resume. */
const PREVIEW = 30;
const clock = { newId, now: () => new Date() };

/** Extracto en PDF elegido; la clave vive solo aquí, en memoria, y se descarta al terminar. */
interface PdfFile {
  readonly name: string;
  readonly data: Uint8Array;
  readonly password: string;
}

/**
 * Importar un extracto del banco (PDF, CSV o Excel): elegir, revisar, ver qué ya estaba
 * registrado (conciliación) e importar lo nuevo.
 */
export default function Import() {
  const { t, locale } = useI18n();
  const { discreet } = useDiscreet();
  const { colors, space, fontSize } = useTheme();
  const database = useLocalDatabase();
  const { sync } = useSync();
  const db = database.status === "ready" ? database.db : null;
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [file, setFile] = useState<{ name: string; table: Table } | null>(null);
  const [pdf, setPdf] = useState<PdfFile | null>(null);
  const [password, setPassword] = useState("");
  const [map, setMap] = useState<ColumnMap | null>(null);
  const [order, setOrder] = useState<DateOrder>("dmy");
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    if (!db) return;
    void (async () => {
      const list = (await sqliteAccounts(db).list()).filter((a) => !a.archivedAt);
      const last = await sqlitePreferences(db).get("movements.lastAccount");
      setAccounts(list);
      setAccountId(
        (current) => current ?? list.find((a) => a.id === last)?.id ?? list[0]?.id ?? null,
      );
    })();
  }, [db]);

  const account = accounts.find((a) => a.id === accountId) ?? null;
  const statement = useMemo(
    () =>
      pdf && account ? readStatement(pdf.data, pdf.password, account.currency, todayCivil()) : null,
    [pdf, account],
  );
  const read = useMemo(() => {
    if (statement?.ok) return { rows: statement.statement.rows, errors: [] };
    return file && map && account ? readRows(file.table, map, account.currency, order) : null;
  }, [statement, file, map, account, order]);

  useEffect(() => {
    if (!db || !read || !accountId) {
      setPlan(null);
      return;
    }
    let active = true;
    void planImport(db, accountId, read.rows).then((p) => {
      if (!active) return;
      setPlan(p);
      setSelected(defaultSelection(p));
    });
    return () => {
      active = false;
    };
  }, [db, read, accountId]);

  if (!db) {
    return (
      <Screen>
        <Body muted>{t("summary.unavailable")}</Body>
      </Screen>
    );
  }

  const pick = async () => {
    setMessage(null);
    try {
      const picked = await pickTableFile();
      if (!picked) return;
      setPassword("");
      if (looksLikePdf(picked.data)) {
        setFile(null);
        setMap(null);
        setPdf({ name: picked.name, data: picked.data, password: "" });
        return;
      }
      setPdf(null);
      const table = readTable(picked.data);
      setFile({ name: picked.name, table });
      setMap(guessColumns(table));
    } catch {
      setFile(null);
      setMessage({ text: t("import.unreadable"), error: true });
    }
  };

  const run = async () => {
    if (!plan || busy) return;
    setBusy(true);
    try {
      const count = await applyImport(db, plan, selected, clock);
      setFile(null);
      setMap(null);
      setPdf(null);
      setPassword("");
      setMessage({ text: t("import.done", { count }), error: false });
      void sync();
    } catch (error) {
      setMessage({
        text: t("import.failed", { reason: error instanceof Error ? error.message : "" }),
        error: true,
      });
    } finally {
      setBusy(false);
    }
  };

  const header = file && map ? (file.table[map.headerRow] ?? []) : [];
  const width = file ? Math.max(0, ...file.table.map((r) => r.length)) : 0;
  const columnLabel = (i: number) => header[i] || t("import.column", { n: i + 1 });
  const count = (s: RowStatus) => plan?.rows.filter((r) => r.status === s).length ?? 0;
  const toImport =
    plan?.rows.filter((r) => r.status !== "duplicate" && selected.has(r.line)).length ?? 0;
  const toggle = (line: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });
  const failure = statement && !statement.ok ? statement.reason : null;
  const parsed = statement?.ok ? statement.statement : null;
  const ready = (file !== null && map !== null) || parsed !== null;
  const statusColor: Record<RowStatus, string> = {
    new: colors.income,
    duplicate: colors.textMuted,
    possible: colors.warning,
  };

  return (
    <Screen>
      <Title>{t("import.title")}</Title>
      <ScrollView contentContainerStyle={{ gap: space.md, paddingBottom: space.xl }}>
        <Body muted>{t("import.intro")}</Body>
        <Button
          label={t(file || pdf ? "import.another" : "import.pick")}
          variant={file || pdf ? "plain" : "primary"}
          onPress={() => void pick()}
        />
        {message ? (
          <Text
            style={{ color: message.error ? colors.expense : colors.text, fontSize: fontSize.body }}
          >
            {message.text}
          </Text>
        ) : null}

        {pdf && failure === "password" ? (
          <>
            <Body>{t(pdf.password ? "import.pdf.wrongPassword" : "import.pdf.password")}</Body>
            <Field
              label={t("import.pdf.passwordLabel")}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="off"
              testID="import-pdf-password"
            />
            <Button label={t("import.pdf.open")} onPress={() => setPdf({ ...pdf, password })} />
          </>
        ) : null}
        {pdf && failure && failure !== "password" ? (
          <Text style={{ color: colors.expense, fontSize: fontSize.body }}>
            {t(failure === "empty" ? "import.pdf.empty" : "import.pdf.unreadable")}
          </Text>
        ) : null}

        {ready ? (
          <>
            {file ? (
              <Body>{t("import.file", { name: file.name, rows: file.table.length })}</Body>
            ) : null}
            {pdf && parsed ? (
              <>
                <Body>
                  {t("import.pdf.read", {
                    bank: parsed.bank ? BANK_NAMES[parsed.bank] : t("import.pdf.bank"),
                    count: parsed.rows.length,
                  })}
                </Body>
                {parsed.balanced !== null ? (
                  <Text
                    style={{
                      color: parsed.balanced ? colors.income : colors.warning,
                      fontSize: fontSize.body,
                    }}
                  >
                    {t(parsed.balanced ? "import.pdf.balanced" : "import.pdf.unbalanced")}
                  </Text>
                ) : null}
                {parsed.skipped > 0 ? (
                  <Text style={{ color: colors.warning, fontSize: fontSize.body }}>
                    {t("import.pdf.skipped", {
                      count: parsed.skipped,
                      rate: Math.round(readRate(parsed) * 100),
                    })}
                  </Text>
                ) : null}
              </>
            ) : null}

            <Body muted>{t("import.account")}</Body>
            <ChipRow testID="import-accounts">
              {accounts.map((a) => (
                <Chip
                  key={a.id}
                  label={a.name}
                  selected={a.id === accountId}
                  onPress={() => setAccountId(a.id)}
                />
              ))}
            </ChipRow>

            {file && map ? (
              <>
                <Body muted>{t("import.columns")}</Body>
                {FIELDS.map((field) => (
                  <View key={field} style={{ gap: space.xs }}>
                    <Text style={{ color: colors.text, fontSize: fontSize.caption }}>
                      {t(`import.field.${field}` as MessageKey)}
                    </Text>
                    <ChipRow testID={`import-field-${field}`}>
                      <Chip
                        label={t("import.none")}
                        selected={map[field] === null}
                        onPress={() => setMap({ ...map, [field]: null })}
                      />
                      {Array.from({ length: width }, (_, i) => (
                        <Chip
                          // biome-ignore lint/suspicious/noArrayIndexKey: las columnas son posiciones.
                          key={i}
                          label={columnLabel(i)}
                          selected={map[field] === i}
                          onPress={() => setMap({ ...map, [field]: i })}
                        />
                      ))}
                    </ChipRow>
                  </View>
                ))}
                <Text style={{ color: colors.text, fontSize: fontSize.caption }}>
                  {t("import.order")}
                </Text>
                <ChipRow>
                  {(["dmy", "mdy"] as const).map((o) => (
                    <Chip
                      key={o}
                      label={t(`import.order.${o}`)}
                      selected={o === order}
                      onPress={() => setOrder(o)}
                    />
                  ))}
                </ChipRow>
              </>
            ) : null}

            {plan ? (
              <>
                <Body>
                  {t("import.summary", {
                    new: count("new"),
                    duplicate: count("duplicate"),
                    possible: count("possible"),
                  })}
                </Body>
                {read && read.errors.length > 0 ? (
                  <Text style={{ color: colors.warning, fontSize: fontSize.body }}>
                    {t("import.errors", {
                      count: read.errors.length,
                      line: read.errors[0]?.line ?? 0,
                    })}
                  </Text>
                ) : null}
                {count("possible") > 0 ? <Body muted>{t("import.possibleHint")}</Body> : null}
                {plan.rows.slice(0, PREVIEW).map((r) => {
                  const on = r.status !== "duplicate" && selected.has(r.line);
                  return (
                    <Pressable
                      key={r.line}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on, disabled: r.status === "duplicate" }}
                      disabled={r.status === "duplicate"}
                      onPress={() => toggle(r.line)}
                      style={{ flexDirection: "row", gap: space.sm, paddingVertical: space.xs }}
                    >
                      <Text style={{ color: colors.text, fontSize: fontSize.body, width: 22 }}>
                        {r.status === "duplicate" ? "–" : on ? "☑" : "☐"}
                      </Text>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={{ color: colors.text, fontSize: fontSize.body }}
                          numberOfLines={1}
                        >
                          {r.description || "—"}
                        </Text>
                        <Text style={{ color: statusColor[r.status], fontSize: fontSize.caption }}>
                          {`${formatCivilDate(r.date, locale)} · ${t(`import.status.${r.status}`)}`}
                        </Text>
                      </View>
                      <Text
                        style={{
                          color: r.amount.isNegative() ? colors.expense : colors.income,
                          fontSize: fontSize.body,
                        }}
                      >
                        {formatMoney(r.amount, { locale, discreet })}
                      </Text>
                    </Pressable>
                  );
                })}
                {plan.rows.length > PREVIEW ? (
                  <Body muted>{t("import.more", { count: plan.rows.length - PREVIEW })}</Body>
                ) : null}
                {toImport > 0 ? (
                  <Button
                    label={t("import.go", { count: toImport })}
                    busy={busy}
                    onPress={() => void run()}
                  />
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
