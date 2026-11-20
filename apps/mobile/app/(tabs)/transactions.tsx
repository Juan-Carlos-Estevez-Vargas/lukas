import type { Account } from "@lukas/domain";
import { FlashList } from "@shopify/flash-list";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { assistantEnabled } from "../../src/assistant/settings";
import { useEntitlements } from "../../src/billing/use-entitlements";
import { Chip, ChipRow, Fab } from "../../src/components/quick";
import { Body, Button, Field, Screen, Title } from "../../src/components/ui";
import { sqliteAccounts } from "../../src/data/ledger-sqlite";
import { useLocalDatabase } from "../../src/data/provider";
import { useDiscreet } from "../../src/display/discreet";
import { formatCivilDate, formatMonth } from "../../src/format/date";
import { formatMoney } from "../../src/format/money";
import { useI18n } from "../../src/i18n/i18n";
import type { ListKind, MovementFilters, MovementRow } from "../../src/movements/filters";
import { type DaySection, groupByDay, listMovements, PAGE_SIZE } from "../../src/movements/list";
import { type Period, periodRange } from "../../src/movements/periods";
import { recentTags } from "../../src/movements/tags";
import { type Month, monthRange, parseMonth } from "../../src/reports/reports";
import { useTheme } from "../../src/theme/theme";

type Item =
  | { readonly type: "header"; readonly section: DaySection }
  | { readonly type: "row"; readonly row: MovementRow };

const KINDS: readonly ListKind[] = ["expense", "income", "transfer"];
const PERIODS: readonly Period[] = ["thisMonth", "lastMonth", "all"];

export default function Transactions() {
  const { t, locale } = useI18n();
  const { discreet } = useDiscreet();
  const { colors, space, fontSize, fontWeight } = useTheme();
  const database = useLocalDatabase();
  const db = database.status === "ready" ? database.db : null;
  // Buscar por significado usa el asistente: solo si la persona lo encendió y su plan lo incluye.
  const [semantic, setSemantic] = useState(false);
  const { can } = useEntitlements();
  useFocusEffect(
    useCallback(() => {
      if (db) void assistantEnabled(db).then(setSemantic);
    }, [db]),
  );

  // Los reportes abren esta pantalla con `?month=2026-10&kind=expense&category=…`.
  const params = useLocalSearchParams<{ month?: string; kind?: string; category?: string }>();
  const [text, setText] = useState("");
  const [kind, setKind] = useState<ListKind | null>(null);
  const [period, setPeriod] = useState<Period>("thisMonth");
  const [month, setMonth] = useState<Month | null>(null);
  const [category, setCategory] = useState<{ id: string; name: string } | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [rows, setRows] = useState<MovementRow[]>([]);
  const [done, setDone] = useState(false);
  const page = useRef(0);
  const request = useRef(0);

  useEffect(() => {
    const wanted = parseMonth(params.month);
    if (!wanted && !params.category && !params.kind) return;
    setMonth(wanted);
    if (params.kind === "income" || params.kind === "expense") setKind(params.kind);
    else setKind(null);
    if (!params.category || !db) {
      setCategory(null);
      return;
    }
    const id = params.category;
    void db
      .get<{ name: string; icon: string | null }>(
        "SELECT name, icon FROM categories WHERE id = ?",
        id,
      )
      .then((c) => setCategory(c ? { id, name: c.icon ? `${c.icon} ${c.name}` : c.name } : null));
  }, [params.month, params.kind, params.category, db]);

  const filters = useMemo<MovementFilters>(() => {
    const { from, to } = month ? monthRange(month) : periodRange(period, new Date());
    return { text, kind, accountId, tag, from, to, categoryId: category?.id ?? null };
  }, [text, kind, accountId, tag, period, month, category]);

  const load = useCallback(
    async (reset: boolean) => {
      if (!db) return;
      const id = ++request.current;
      const next = reset ? 0 : page.current + 1;
      const found = await listMovements(db, filters, next);
      if (id !== request.current) return; // llegó otra búsqueda mientras tanto
      page.current = next;
      setDone(found.length < PAGE_SIZE);
      setRows((prev) => (reset ? found : [...prev, ...found]));
    },
    [db, filters],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      if (!db) return;
      void load(true);
      void sqliteAccounts(db).list().then(setAccounts);
      void recentTags(db).then(setTags);
    }, [db, load]),
  );

  const items = useMemo<Item[]>(
    () =>
      groupByDay(rows).flatMap((section) => [
        { type: "header", section } as const,
        ...section.rows.map((row) => ({ type: "row", row }) as const),
      ]),
    [rows],
  );
  const stickyHeaderIndices = useMemo(
    () => items.flatMap((item, i) => (item.type === "header" ? [i] : [])),
    [items],
  );

  if (!db) {
    return (
      <Screen>
        <Title>{t("tabs.transactions")}</Title>
        <Body muted>{t("summary.unavailable")}</Body>
      </Screen>
    );
  }

  const money = (row: MovementRow) => formatMoney(row.amount, { locale, discreet });
  const toggle = <T,>(value: T, current: T | null, set: (v: T | null) => void) =>
    set(current === value ? null : value);

  return (
    <Screen>
      <Title>{t("tabs.transactions")}</Title>
      <Field
        label={t("list.search")}
        value={text}
        onChangeText={setText}
        placeholder={t("list.searchHint")}
        autoCorrect={false}
        returnKeyType="search"
      />
      {semantic && can("semanticSearch") ? (
        <Button label={t("search.open")} variant="plain" onPress={() => router.push("/search")} />
      ) : null}
      <ChipRow>
        {month ? (
          <Chip
            label={`${formatMonth(month, locale, "long")} ✕`}
            selected
            onPress={() => setMonth(null)}
          />
        ) : null}
        {category ? (
          <Chip label={`${category.name} ✕`} selected onPress={() => setCategory(null)} />
        ) : null}
        {PERIODS.map((p) => (
          <Chip
            key={p}
            label={t(`list.period.${p}`)}
            selected={!month && period === p}
            onPress={() => {
              setMonth(null);
              setPeriod(p);
            }}
          />
        ))}
        {KINDS.map((k) => (
          <Chip
            key={k}
            label={t(`list.kind.${k}`)}
            selected={kind === k}
            onPress={() => toggle(k, kind, setKind)}
          />
        ))}
      </ChipRow>
      {accounts.length > 1 || tags.length > 0 ? (
        <ChipRow>
          {accounts.map((a) => (
            <Chip
              key={a.id}
              label={a.name}
              selected={accountId === a.id}
              onPress={() => toggle(a.id, accountId, setAccountId)}
            />
          ))}
          {tags.map((g) => (
            <Chip
              key={g}
              label={`#${g}`}
              selected={tag === g}
              onPress={() => toggle(g, tag, setTag)}
            />
          ))}
        </ChipRow>
      ) : null}

      <View style={{ flex: 1 }}>
        <FlashList
          data={items}
          keyExtractor={(item) => (item.type === "header" ? item.section.key : item.row.id)}
          getItemType={(item) => item.type}
          stickyHeaderIndices={stickyHeaderIndices}
          onEndReached={() => {
            if (!done) void load(false);
          }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 80 }}
          ListEmptyComponent={<Body muted>{t("list.empty")}</Body>}
          renderItem={({ item }) =>
            item.type === "header" ? (
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  paddingVertical: space.sm,
                  backgroundColor: colors.background,
                }}
              >
                <Text style={{ color: colors.textMuted, fontSize: fontSize.caption }}>
                  {formatCivilDate(item.section.day, locale)}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: fontSize.caption }}>
                  {formatMoney(item.section.net, { locale, discreet })}
                </Text>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(`/movement/${item.row.id}`)}
                style={{
                  minHeight: 56,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.md,
                  paddingVertical: space.xs,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      color: colors.text,
                      fontSize: fontSize.body,
                      fontWeight: fontWeight.medium,
                    }}
                  >
                    {item.row.title || t(`list.kind.${item.row.kind}`)}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={{ color: colors.textMuted, fontSize: fontSize.caption }}
                  >
                    {[
                      ...item.row.categoryNames,
                      item.row.kind === "transfer" ? null : item.row.accountNames.join(", "),
                      ...item.row.tags.map((g) => `#${g}`),
                      item.row.hasReceipt ? "📎" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </View>
                <Text
                  style={{
                    fontSize: fontSize.body,
                    fontWeight: fontWeight.medium,
                    color:
                      item.row.kind === "expense"
                        ? colors.expense
                        : item.row.kind === "income"
                          ? colors.income
                          : colors.text,
                  }}
                >
                  {money(item.row)}
                </Text>
              </Pressable>
            )
          }
        />
      </View>
      <Fab label={t("movement.add")} onPress={() => router.push("/movement/new")} />
    </Screen>
  );
}
