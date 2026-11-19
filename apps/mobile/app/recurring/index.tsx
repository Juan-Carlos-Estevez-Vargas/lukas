import type { Money, Recurrence } from "@lukas/domain";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { civilDate } from "../../src/accounts/credit-card";
import { Body, Button, Screen, Title } from "../../src/components/ui";
import { newId } from "../../src/data/ids";
import { useLocalDatabase } from "../../src/data/provider";
import { useDiscreet } from "../../src/display/discreet";
import { formatCivilDate } from "../../src/format/date";
import { formatMoney } from "../../src/format/money";
import { useI18n } from "../../src/i18n/i18n";
import {
  archiveRecurring,
  listRecurring,
  pendingOf,
  postOccurrence,
  type Recurring,
  skipOccurrence,
  upcomingOf,
} from "../../src/recurring/recurring";
import { useRecurring } from "../../src/recurring/use-recurring";

const clock = { newId, now: () => new Date() };

/** Lista de recurrentes: próximo cobro, pendientes por confirmar y archivar. */
export default function RecurringList() {
  const { t, locale } = useI18n();
  const { discreet } = useDiscreet();
  const database = useLocalDatabase();
  const recurring = useRecurring();
  const db = database.status === "ready" ? database.db : null;
  const [items, setItems] = useState<Recurring[]>([]);

  const load = useCallback(async () => {
    if (db) setItems(await listRecurring(db));
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Si se registraron recurrentes con la pantalla abierta (al volver a la app), recargar.
  useEffect(() => {
    if (recurring.version > 0) void load();
  }, [recurring.version, load]);

  if (!db) {
    return (
      <Screen>
        <Body muted>{t("summary.unavailable")}</Body>
      </Screen>
    );
  }

  const today = civilDate(new Date());
  const money = (m: Money) => formatMoney(m, { locale, discreet });
  const every = (r: Recurrence) =>
    r.every === 1
      ? t(`recurring.freq.${r.frequency}`)
      : t("recurring.everyN", { n: String(r.every), unit: t(`recurring.unit.${r.frequency}`) });
  const after = (work: Promise<unknown>) =>
    void work.then(() => {
      recurring.refresh();
      return load();
    });

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 16 }}>
        <Title>{t("recurring.title")}</Title>
        <Body muted>{t("recurring.body")}</Body>
        {items.length === 0 ? <Body muted>{t("recurring.empty")}</Body> : null}
        {items.map((r) => {
          const next = upcomingOf(r, today);
          return (
            <View key={r.id} style={{ gap: 4 }}>
              <Body>{`${r.name} · ${money(r.amount)}`}</Body>
              <Body muted>
                {`${every(r.recurrence)} · ${
                  next
                    ? t("recurring.next", { date: formatCivilDate(next, locale) })
                    : t("recurring.ended")
                }`}
              </Body>
              {recurring.failed.includes(r.id) ? (
                <Body tone="error">{t("recurring.failed", { name: r.name })}</Body>
              ) : null}
              {pendingOf(r, today).map((on) => (
                <View
                  key={`${on.year}-${on.month}-${on.day}`}
                  style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                >
                  <View style={{ flex: 1 }}>
                    <Body>{t("recurring.pending", { date: formatCivilDate(on, locale) })}</Body>
                  </View>
                  <Button
                    label={t("recurring.post")}
                    variant="plain"
                    onPress={() => after(postOccurrence(db, r, on, clock))}
                  />
                  <Button
                    label={t("recurring.skip")}
                    variant="plain"
                    onPress={() => after(skipOccurrence(db, r, on, clock))}
                  />
                </View>
              ))}
              <Button
                label={t("recurring.archive")}
                variant="plain"
                onPress={() => after(archiveRecurring(db, r.id, clock))}
              />
            </View>
          );
        })}
        <Button label={t("recurring.new")} onPress={() => router.push("/recurring/new")} />
      </ScrollView>
    </Screen>
  );
}
