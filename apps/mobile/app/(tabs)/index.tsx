import { type Account, Money } from "@lukas/domain";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";
import { Body, Screen, Title } from "../../src/components/ui";
import { sqliteAccounts } from "../../src/data/ledger-sqlite";
import { useLocalDatabase } from "../../src/data/provider";
import { useDiscreet } from "../../src/display/discreet";
import { formatMoney } from "../../src/format/money";
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

  useFocusEffect(
    useCallback(() => {
      if (database.status !== "ready") return;
      const repo = sqliteAccounts(database.db);
      void (async () => {
        const accounts = await repo.list();
        setRows(
          await Promise.all(
            accounts.map(async (a) => ({ account: a, balance: await repo.balance(a) })),
          ),
        );
      })();
    }, [database]),
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
  const netWorth = rows
    .filter((r) => r.account.currency === "COP")
    .reduce((sum, r) => sum.add(r.balance), Money.zero("COP"));

  return (
    <Screen>
      <Title>{t("tabs.summary")}</Title>
      <Body muted>{t("summary.netWorth")}</Body>
      <Title>{fmt(netWorth)}</Title>
      <Body muted>{t("summary.accounts")}</Body>
      {rows.length === 0 ? <Body muted>{t("summary.empty")}</Body> : null}
      {rows.map((r) => (
        <View key={r.account.id} style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Body>{r.account.name}</Body>
          <Body>{fmt(r.balance)}</Body>
        </View>
      ))}
    </Screen>
  );
}
