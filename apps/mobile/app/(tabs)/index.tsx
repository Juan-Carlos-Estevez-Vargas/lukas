import { type Account, Money } from "@lukas/domain";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { groupAccounts } from "../../src/accounts/templates";
import { Fab } from "../../src/components/quick";
import { Body, Button, Screen, Title, Toggle } from "../../src/components/ui";
import { sqliteAccounts } from "../../src/data/ledger-sqlite";
import { useLocalDatabase } from "../../src/data/provider";
import { useDiscreet } from "../../src/display/discreet";
import { formatMoney } from "../../src/format/money";
import type { MessageKey } from "../../src/i18n/es";
import { useI18n } from "../../src/i18n/i18n";

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

  useFocusEffect(
    useCallback(() => {
      if (database.status !== "ready") return;
      const repo = sqliteAccounts(database.db);
      void (async () => {
        const accounts = await repo.list({ includeArchived: showArchived });
        setRows(
          await Promise.all(
            accounts.map(async (a) => ({ account: a, balance: await repo.balance(a) })),
          ),
        );
      })();
    }, [database, showArchived]),
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
  // El patrimonio suma solo cuentas activas en pesos; otras monedas llegan con FIN-107.
  const netWorth = rows
    .filter((r) => r.account.currency === "COP" && !r.account.archivedAt)
    .reduce((sum, r) => sum.add(r.balance), Money.zero("COP"));

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 80 }}>
        <Title>{t("tabs.summary")}</Title>
        <Body muted>{t("summary.netWorth")}</Body>
        <Title>{fmt(netWorth)}</Title>
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
