import { type Account, Money, type RateTable } from "@lukas/domain";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { civilDate } from "../../src/accounts/credit-card";
import { groupAccounts } from "../../src/accounts/templates";
import { pendingCount } from "../../src/capture/ingest";
import { Fab } from "../../src/components/quick";
import { Body, Button, Screen, Title, Toggle } from "../../src/components/ui";
import { sqliteAccounts } from "../../src/data/ledger-sqlite";
import { useLocalDatabase } from "../../src/data/provider";
import { useDiscreet } from "../../src/display/discreet";
import { formatCivilDate } from "../../src/format/date";
import { formatMoney } from "../../src/format/money";
import {
  type CategorySpend,
  type MonthAvailable,
  monthAvailable,
  type NetWorth,
  netWorthOf,
  topCategories,
  type UpcomingPayment,
  upcomingPayments,
} from "../../src/home/home";
import {
  AvailableCard,
  InboxCard,
  ProjectionAlertCard,
  TopCategoriesCard,
  UpcomingCard,
} from "../../src/home/home-cards";
import type { MessageKey } from "../../src/i18n/es";
import { useI18n } from "../../src/i18n/i18n";
import { useAppLock } from "../../src/lock/app-lock";
import { type AccountProjection, atRisk, projectAccounts } from "../../src/projection/projection";
import { ratesClient } from "../../src/rates/client";
import { copRates, refreshRates, type StoredRate } from "../../src/rates/rates";
import { parseCivil } from "../../src/recurring/recurring";
import { useRecurring } from "../../src/recurring/use-recurring";
import { useSync } from "../../src/sync/use-sync";
import { updateWidgets } from "../../src/widgets/bridge";
import { availableSnapshot } from "../../src/widgets/snapshot";

interface Row {
  readonly account: Account;
  readonly balance: Money;
}

export default function Summary() {
  const { t, locale } = useI18n();
  const { discreet } = useDiscreet();
  const database = useLocalDatabase();
  const [rows, setRows] = useState<Row[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [available, setAvailable] = useState<MonthAvailable | null>(null);
  const [top, setTop] = useState<CategorySpend[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingPayment[]>([]);
  const [risky, setRisky] = useState<AccountProjection[]>([]);
  const [pending, setPending] = useState(0);
  const [worth, setWorth] = useState<NetWorth | null>(null);
  const [usd, setUsd] = useState<StoredRate | null>(null);
  const { version } = useRecurring();
  const { version: synced } = useSync();
  const lock = useAppLock();
  // Los widgets se ven sin desbloquear: con PIN o modo discreto no muestran el monto.
  const hiddenOnWidget = discreet || lock.status !== "off";

  useEffect(() => {
    if (!available) return;
    const snapshot = availableSnapshot(available.available, {
      locale,
      hidden: hiddenOnWidget,
      label: t("widget.label"),
      hint: t(hiddenOnWidget ? "widget.hidden" : "widget.hint"),
    });
    void updateWidgets(snapshot, t("widget.quick")).catch(() => undefined);
  }, [available, hiddenOnWidget, locale, t]);

  useFocusEffect(
    useCallback(() => {
      // `version` y `synced` cambian si llegan recurrentes o datos de otro dispositivo.
      if (database.status !== "ready" || version < 0 || synced < 0) return;
      const repo = sqliteAccounts(database.db);
      const today = civilDate(new Date());
      let active = true;
      const load = async () => {
        const rates = await copRates(database.db);
        const table: RateTable = rates.table;
        const available = await monthAvailable(database.db, today, "COP", table);
        const top = await topCategories(database.db, today, "COP", 3, table);
        const upcoming = await upcomingPayments(database.db, today);
        const risky = atRisk(await projectAccounts(database.db, today));
        const pending = await pendingCount(database.db);
        const accounts = await repo.list({ includeArchived: showArchived });
        const rows = await Promise.all(
          accounts.map(async (a) => ({ account: a, balance: await repo.balance(a) })),
        );
        if (!active) return;
        setAvailable(available);
        setTop(top);
        setUpcoming(upcoming);
        setRisky(risky);
        setPending(pending);
        setRows(rows);
        setUsd(rates.usd);
        setWorth(
          netWorthOf(
            rows.map((r) => ({ balance: r.balance, archived: r.account.archivedAt !== null })),
            "COP",
            table,
          ),
        );
      };
      void (async () => {
        await load();
        // La TRM se pide en segundo plano; si llega una nueva, se recalcula con ella.
        const before = (await copRates(database.db)).usd?.day;
        await refreshRates(database.db, ratesClient, today, new Date());
        if ((await copRates(database.db)).usd?.day !== before) await load();
      })().catch(() => undefined);
      return () => {
        active = false;
      };
    }, [database, showArchived, version, synced]),
  );

  if (database.status === "error") {
    return (
      <Screen>
        <Title>{t("tabs.summary")}</Title>
        <Body muted>{t("summary.unavailable")}</Body>
      </Screen>
    );
  }

  const fmt = (m: Money) => formatMoney(m, { locale, discreet });
  const hasUsd = rows.some((r) => r.account.currency === "USD" && !r.account.archivedAt);
  const usdDay = usd ? parseCivil(usd.day) : null;
  // La TRM es un dato público: se muestra aunque el modo discreto esté activo.
  const trmText = (rate: string) => {
    const parsed = Money.parse(rate, "COP");
    return parsed.ok ? formatMoney(parsed.value, { locale, alwaysShowCents: true }) : rate;
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 80 }}>
        <InboxCard count={pending} onOpen={() => router.push("/inbox")} />
        {available ? <AvailableCard data={available} /> : null}
        <TopCategoriesCard data={top} />
        <ProjectionAlertCard
          data={risky}
          onOpen={(account) => router.push({ pathname: "/(tabs)/reports", params: { account } })}
        />
        <UpcomingCard data={upcoming} />
        <Body muted>{t("summary.netWorth")}</Body>
        {worth ? <Title>{fmt(worth.total)}</Title> : null}
        {hasUsd && usd && usdDay ? (
          <Body muted>
            {t("summary.trm", {
              rate: trmText(usd.rate),
              date: formatCivilDate(usdDay, locale),
            })}
          </Body>
        ) : null}
        {worth && worth.missing.length > 0 ? (
          <Body muted>{t("summary.noRate", { currencies: worth.missing.join(", ") })}</Body>
        ) : null}
        {rows.length === 0 ? <Body muted>{t("summary.empty")}</Body> : null}
        {groupAccounts(rows).map(({ group, rows: items }) => (
          <View key={group} style={{ gap: 4 }}>
            <Body muted>{t(`groups.${group}` as MessageKey)}</Body>
            {items.map((r) => (
              <Pressable
                key={r.account.id}
                accessibilityRole="button"
                onPress={() => router.push(`/accounts/${r.account.id}`)}
                style={{
                  minHeight: 44,
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  opacity: r.account.archivedAt ? 0.6 : 1,
                }}
              >
                <Body>{r.account.name}</Body>
                <Body>{fmt(r.balance)}</Body>
              </Pressable>
            ))}
          </View>
        ))}
        <Button label={t("accounts.add")} onPress={() => router.push("/accounts/new")} />
        <Toggle
          label={t("accounts.showArchived")}
          value={showArchived}
          onChange={setShowArchived}
        />
      </ScrollView>
      {rows.length > 0 ? (
        <Fab label={t("movement.add")} onPress={() => router.push("/movement/new")} />
      ) : null}
    </Screen>
  );
}
