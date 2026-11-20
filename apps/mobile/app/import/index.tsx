import type { Account } from "@lukas/domain";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Chip, ChipRow } from "../../src/components/quick";
import { Body, Button, Screen, Title } from "../../src/components/ui";
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
import { readTable, type Table } from "../../src/import/table";
import { useSync } from "../../src/sync/use-sync";
import { useTheme } from "../../src/theme/theme";

type Field = Exclude<keyof ColumnMap, "headerRow">;
const FIELDS: readonly Field[] = ["date", "description", "amount", "debit", "credit", "category"];
/** Filas que se muestran en la vista previa; el resto se resume. */
const PREVIEW = 30;
const clock = { newId, now: () => new Date() };

/** Importar un CSV o Excel del banco: elegir, revisar columnas, ver qué es nuevo e importar. */
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
  const read = useMemo(
    () => (file && map && account ? readRows(file.table, map, account.currency, order) : null),
    [file, map, account, order],
  );

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
          label={t(file ? "import.another" : "import.pick")}
          variant={file ? "plain" : "primary"}
          onPress={() => void pick()}
        />
        {message ? (
          <Text
            style={{ color: message.error ? colors.expense : colors.text, fontSize: fontSize.body }}
          >
            {message.text}
          </Text>
        ) : null}

        {file && map ? (
          <>
            <Body>{t("import.file", { name: file.name, rows: file.table.length })}</Body>

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
