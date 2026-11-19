import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView } from "react-native";
import { accountErrorKey } from "../../src/accounts/messages";
import { Chip, ChipRow } from "../../src/components/quick";
import { Body, Button, Loading, Screen, Title } from "../../src/components/ui";
import { newId } from "../../src/data/ids";
import { useLocalDatabase } from "../../src/data/provider";
import { useDiscreet } from "../../src/display/discreet";
import { formatMoney } from "../../src/format/money";
import { useI18n } from "../../src/i18n/i18n";
import type { MovementRow } from "../../src/movements/filters";
import { movementById } from "../../src/movements/list";
import { type Category, listCategories, recategorize } from "../../src/movements/movements";

/** Detalle de un movimiento. Cambiar la categoría enseña a la app para la próxima vez. */
export default function MovementDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const { discreet } = useDiscreet();
  const database = useLocalDatabase();
  const db = database.status === "ready" ? database.db : null;
  const [row, setRow] = useState<MovementRow | null | undefined>(undefined);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (!db || !id) return;
    const found = await movementById(db, id);
    setRow(found);
    if (found && (found.kind === "expense" || found.kind === "income")) {
      setCategories(await listCategories(db, found.kind, new Date()));
    }
  }, [db, id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (row === undefined) return <Loading />;
  if (!row || !db) {
    return (
      <Screen>
        <Body>{t("movement.notFound")}</Body>
        <Button label={t("lock.cancel")} variant="plain" onPress={() => router.back()} />
      </Screen>
    );
  }

  const editable =
    (row.kind === "expense" || row.kind === "income") && row.categoryIds.length === 1;
  const change = async (categoryId: string) => {
    setError(null);
    const res = await recategorize(db, row.id, categoryId, { newId, now: () => new Date() });
    if (!res.ok) return setError(t(accountErrorKey(res.error)));
    setSaved(true);
    await load();
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 12 }}>
        <Title>{formatMoney(row.amount, { locale, discreet })}</Title>
        <Body>{row.title}</Body>
        <Body muted>
          {[
            row.occurredAt.toLocaleDateString(locale),
            ...row.accountNames,
            ...row.tags.map((g) => `#${g}`),
          ].join(" · ")}
        </Body>
        {row.notes ? <Body muted>{row.notes}</Body> : null}
        {row.categoryNames.length > 0 ? <Body>{row.categoryNames.join(", ")}</Body> : null}
        {editable ? (
          <>
            <Body muted>{t("movement.changeCategory")}</Body>
            <ChipRow>
              {categories.map((c) => (
                <Chip
                  key={c.id}
                  label={c.icon ? `${c.icon} ${c.name}` : c.name}
                  selected={row.categoryIds.includes(c.id)}
                  onPress={() => void change(c.id)}
                />
              ))}
            </ChipRow>
            {saved ? <Body muted>{t("movement.learned")}</Body> : null}
          </>
        ) : null}
        {error ? <Body tone="error">{error}</Body> : null}
        <Button label={t("lock.cancel")} variant="plain" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}
