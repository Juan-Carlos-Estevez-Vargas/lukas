import { BUDGET_GROUPS, type BudgetGroup } from "@lukas/domain";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { categoryGroups, type GroupedCategory, setBudgetGroup } from "../../src/budgets/budgets";
import { Chip, ChipRow } from "../../src/components/quick";
import { Body, Screen, Title } from "../../src/components/ui";
import { useLocalDatabase } from "../../src/data/provider";
import { useI18n } from "../../src/i18n/i18n";

/** Qué categorías son necesidades, gustos o ahorro para la regla 50/30/20. */
export default function BudgetGroups() {
  const { t } = useI18n();
  const database = useLocalDatabase();
  const db = database.status === "ready" ? database.db : null;
  const [categories, setCategories] = useState<GroupedCategory[]>([]);

  const load = useCallback(async () => {
    if (db) setCategories(await categoryGroups(db));
  }, [db]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!db) {
    return (
      <Screen>
        <Body muted>{t("summary.unavailable")}</Body>
      </Screen>
    );
  }

  const choose = (id: string, group: BudgetGroup | null) =>
    void setBudgetGroup(db, id, group).then(load);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 16 }}>
        <Title>{t("budgets.groups.title")}</Title>
        <Body muted>{t("budgets.rule.body")}</Body>
        {categories.map((c) => (
          <View key={c.id} style={{ gap: 4 }}>
            <Body>{c.icon ? `${c.icon} ${c.name}` : c.name}</Body>
            <ChipRow>
              {BUDGET_GROUPS.map((g) => (
                <Chip
                  key={g}
                  label={t(`budgets.group.${g}`)}
                  selected={c.group === g}
                  onPress={() => choose(c.id, g)}
                />
              ))}
              <Chip
                label={t("budgets.group.none")}
                selected={c.group === null}
                onPress={() => choose(c.id, null)}
              />
            </ChipRow>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}
