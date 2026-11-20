import type { Account } from "@lukas/domain";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import {
  acceptCapture,
  dismissCapture,
  type InboxItem,
  inbox,
  ingestCapture,
  linkCapture,
} from "../../src/capture/ingest";
import { Chip, ChipRow } from "../../src/components/quick";
import { Body, Button, Screen, Title } from "../../src/components/ui";
import { e2eMode } from "../../src/config";
import { newId } from "../../src/data/ids";
import { sqliteAccounts } from "../../src/data/ledger-sqlite";
import { useLocalDatabase } from "../../src/data/provider";
import { useDiscreet } from "../../src/display/discreet";
import { formatMoney } from "../../src/format/money";
import { useI18n } from "../../src/i18n/i18n";
import { useSync } from "../../src/sync/use-sync";
import { useTheme } from "../../src/theme/theme";

const clock = { newId, now: () => new Date() };

/** Bandeja "Por revisar": lo que llegó solo (notificaciones, correos) antes de volverse movimiento. */
export default function Inbox() {
  const { t, locale } = useI18n();
  const { discreet } = useDiscreet();
  const { colors, space, radius, fontSize } = useTheme();
  const database = useLocalDatabase();
  const { sync } = useSync();
  const db = database.status === "ready" ? database.db : null;
  const [items, setItems] = useState<InboxItem[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!db) return;
    setItems(await inbox(db));
    setAccounts((await sqliteAccounts(db).list()).filter((a) => !a.archivedAt));
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!db) {
    return (
      <Screen>
        <Body muted>{t("summary.unavailable")}</Body>
      </Screen>
    );
  }

  const act = async (id: string, action: () => Promise<unknown>) => {
    setBusy(id);
    try {
      await action();
      await load();
      void sync();
    } finally {
      setBusy(null);
    }
  };

  const when = (d: Date) =>
    new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(d);

  return (
    <Screen>
      <Title>{t("inbox.title")}</Title>
      <ScrollView contentContainerStyle={{ gap: space.md, paddingBottom: space.xl }}>
        <Body muted>{t(items.length === 0 ? "inbox.empty" : "inbox.intro")}</Body>
        {items.map((item) => {
          const accountId = chosen[item.id] ?? item.accountId;
          const signed = item.kind === "expense" ? item.amount.negate() : item.amount;
          return (
            <View
              key={item.id}
              testID="inbox-item"
              style={{
                gap: space.xs,
                padding: space.md,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface,
              }}
            >
              <View
                style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}
              >
                <Text
                  style={{ color: colors.text, fontSize: fontSize.body, flex: 1 }}
                  numberOfLines={1}
                >
                  {item.merchant ?? t(`inbox.kind.${item.kind}`)}
                </Text>
                <Text
                  style={{
                    color: item.kind === "expense" ? colors.expense : colors.income,
                    fontSize: fontSize.body,
                  }}
                >
                  {formatMoney(signed, { locale, discreet })}
                </Text>
              </View>
              <Text style={{ color: colors.textMuted, fontSize: fontSize.caption }}>
                {`${when(item.occurredAt)} · ${t(`inbox.source.${item.source}`)}${item.last4 ? ` · *${item.last4}` : ""}`}
              </Text>
              {item.matchTransactionId ? (
                <Text style={{ color: colors.warning, fontSize: fontSize.caption }}>
                  {t("inbox.maybeRecorded")}
                </Text>
              ) : null}
              {!item.accountId ? (
                <>
                  <Text style={{ color: colors.text, fontSize: fontSize.caption }}>
                    {t("inbox.whichAccount")}
                  </Text>
                  <ChipRow>
                    {accounts
                      .filter((a) => a.currency === item.amount.currencyCode)
                      .map((a) => (
                        <Chip
                          key={a.id}
                          label={a.name}
                          selected={a.id === accountId}
                          onPress={() => setChosen((c) => ({ ...c, [item.id]: a.id }))}
                        />
                      ))}
                  </ChipRow>
                </>
              ) : null}
              <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
                {item.matchTransactionId ? (
                  <Button
                    label={t("inbox.link")}
                    variant="plain"
                    busy={busy === item.id}
                    onPress={() => void act(item.id, () => linkCapture(db, item.id))}
                  />
                ) : null}
                {accountId ? (
                  <Button
                    label={t("inbox.accept")}
                    variant={item.matchTransactionId ? "plain" : "primary"}
                    busy={busy === item.id}
                    onPress={() =>
                      void act(item.id, () =>
                        acceptCapture(
                          db,
                          item.id,
                          { accountId, categoryId: item.categoryId },
                          clock,
                        ),
                      )
                    }
                  />
                ) : null}
                <Button
                  label={t("inbox.dismiss")}
                  variant="plain"
                  busy={busy === item.id}
                  onPress={() => void act(item.id, () => dismissCapture(db, item.id))}
                />
              </View>
            </View>
          );
        })}
        {e2eMode ? (
          <Button
            label="Simular aviso de compra"
            variant="plain"
            onPress={() =>
              void act("demo", async () => {
                const now = new Date();
                await ingestCapture(
                  db,
                  {
                    source: "notification",
                    app: "com.nequi.MobileApp",
                    receivedAt: now,
                    amount: "$ 23.450",
                    merchant: "Pago en Tiendas Ara",
                  },
                  clock,
                );
                await ingestCapture(
                  db,
                  {
                    source: "email",
                    app: "notificaciones@nequi.com.co",
                    receivedAt: new Date(now.getTime() + 60_000),
                    occurredAt: now,
                    amount: "23450",
                    merchant: "Tiendas Ara",
                  },
                  clock,
                );
              })
            }
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}
