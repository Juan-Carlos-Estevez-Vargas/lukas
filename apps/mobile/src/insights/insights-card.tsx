import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { civilDate } from "../accounts/credit-card";
import { Body, Button } from "../components/ui";
import { newId } from "../data/ids";
import type { SqlConnection } from "../data/sql";
import { useDiscreet } from "../display/discreet";
import { formatCivilDate } from "../format/date";
import { formatMoney } from "../format/money";
import { Card } from "../home/home-cards";
import { useI18n } from "../i18n/i18n";
import { useRecurring } from "../recurring/use-recurring";
import {
  acceptSubscription,
  type DuplicateCharge,
  detectDuplicates,
  detectSubscriptions,
  dismissInsight,
  type SubscriptionSuggestion,
} from "./subscriptions";

/**
 * Avisos del Resumen: cobros que parecen duplicados y suscripciones sin recurrente. Se recalcula
 * cuando cambia `reload` (nuevos movimientos, recurrentes o datos sincronizados).
 */
export function InsightsCard({
  db,
  reload,
}: {
  readonly db: SqlConnection;
  readonly reload: number;
}) {
  const { t, locale } = useI18n();
  const { discreet } = useDiscreet();
  const recurring = useRecurring();
  const [subs, setSubs] = useState<SubscriptionSuggestion[]>([]);
  const [dups, setDups] = useState<DuplicateCharge[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (reload < 0) return;
    const now = new Date();
    setDups(await detectDuplicates(db, now));
    setSubs(await detectSubscriptions(db, now));
  }, [db, reload]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const act = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await action();
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (subs.length === 0 && dups.length === 0) return null;
  const fmt = formatMoney;
  return (
    <>
      {dups.map((d) => (
        <Card key={d.key} title={t("insights.duplicate.title")}>
          <Body>
            {t("insights.duplicate.body", {
              merchant: d.merchant,
              amount: fmt(d.amount, { locale, discreet }),
              date: formatCivilDate(civilDate(d.occurredAt), locale),
            })}
          </Body>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Button
              label={t("insights.duplicate.open")}
              variant="plain"
              onPress={() => router.push(`/movement/${d.transactionIds[1]}`)}
            />
            <Button
              label={t("insights.duplicate.fine")}
              variant="plain"
              busy={busy === d.key}
              onPress={() => void act(d.key, () => dismissInsight(db, d.key))}
            />
          </View>
        </Card>
      ))}
      {subs.slice(0, 3).map((s) => (
        <Card key={s.key} title={t("insights.subscription.title")}>
          <Body>
            {t(`insights.subscription.${s.frequency}`, {
              merchant: s.merchant,
              amount: fmt(s.amount, { locale, discreet }),
              date: formatCivilDate(s.nextOn, locale),
            })}
          </Body>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Button
              label={t("insights.subscription.accept")}
              variant="plain"
              busy={busy === s.key}
              onPress={() =>
                void act(s.key, async () => {
                  await acceptSubscription(db, s, { newId, now: () => new Date() });
                  recurring.refresh();
                })
              }
            />
            <Button
              label={t("insights.subscription.dismiss")}
              variant="plain"
              busy={busy === s.key}
              onPress={() => void act(s.key, () => dismissInsight(db, s.key))}
            />
          </View>
        </Card>
      ))}
    </>
  );
}
