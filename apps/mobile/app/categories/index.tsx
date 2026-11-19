import type { CategoryRule, MovementKind } from "@lukas/domain";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";
import { accountErrorKey } from "../../src/accounts/messages";
import { Chip, ChipRow } from "../../src/components/quick";
import { Body, Button, Field, Screen, Title } from "../../src/components/ui";
import { newId } from "../../src/data/ids";
import { useLocalDatabase } from "../../src/data/provider";
import { useI18n } from "../../src/i18n/i18n";
import {
  addRule,
  archiveCategory,
  type CategoryNode,
  categoryTree,
  createCategory,
  listRules,
  removeRule,
} from "../../src/movements/categories";

const clock = { newId, now: () => new Date() };

/** Categorías con subcategorías e íconos, y las reglas que asignan categoría por comercio. */
export default function Categories() {
  const { t } = useI18n();
  const database = useLocalDatabase();
  const db = database.status === "ready" ? database.db : null;
  const [kind, setKind] = useState<MovementKind>("expense");
  const [tree, setTree] = useState<CategoryNode[]>([]);
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [pattern, setPattern] = useState("");
  const [match, setMatch] = useState<"merchant" | "keyword">("keyword");
  const [ruleCategory, setRuleCategory] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!db) return;
    setTree(await categoryTree(db, kind));
    setRules(await listRules(db, kind));
  }, [db, kind]);

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

  const all = tree.flatMap((n) => [n, ...n.children]);
  const nameOf = (id: string) => all.find((c) => c.id === id)?.name ?? "?";
  const label = (c: CategoryNode) => (c.icon ? `${c.icon} ${c.name}` : c.name);

  const create = async () => {
    setError(null);
    const res = await createCategory(db, { name, kind, icon, parentId }, clock);
    if (!res.ok) return setError(t(accountErrorKey(res.error)));
    setName("");
    setIcon("");
    setParentId(null);
    await load();
  };

  const saveRule = async () => {
    setError(null);
    if (!ruleCategory) return setError(t("movement.error.category"));
    const res = await addRule(db, { match, pattern, categoryId: ruleCategory }, clock);
    if (!res.ok) return setError(t(accountErrorKey(res.error)));
    setPattern("");
    await load();
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
        <Title>{t("categories.title")}</Title>
        <ChipRow>
          <Chip
            label={t("list.kind.expense")}
            selected={kind === "expense"}
            onPress={() => setKind("expense")}
          />
          <Chip
            label={t("list.kind.income")}
            selected={kind === "income"}
            onPress={() => setKind("income")}
          />
        </ChipRow>

        {tree.map((parent) => (
          <View key={parent.id} style={{ gap: 4 }}>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Body>{label(parent)}</Body>
              <Button
                label={t("categories.archive")}
                variant="plain"
                onPress={() => void archiveCategory(db, parent.id, new Date()).then(load)}
              />
            </View>
            {parent.children.map((child) => (
              <View
                key={child.id}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  paddingLeft: 24,
                }}
              >
                <Body muted>{label(child)}</Body>
                <Button
                  label={t("categories.archive")}
                  variant="plain"
                  onPress={() => void archiveCategory(db, child.id, new Date()).then(load)}
                />
              </View>
            ))}
          </View>
        ))}

        <Title>{t("categories.new")}</Title>
        <Field label={t("categories.name")} value={name} onChangeText={setName} />
        <Field label={t("categories.icon")} value={icon} onChangeText={setIcon} maxLength={4} />
        <Body muted>{t("categories.parent")}</Body>
        <ChipRow>
          <Chip
            label={t("categories.noParent")}
            selected={parentId === null}
            onPress={() => setParentId(null)}
          />
          {tree.map((p) => (
            <Chip
              key={p.id}
              label={label(p)}
              selected={parentId === p.id}
              onPress={() => setParentId(p.id)}
            />
          ))}
        </ChipRow>
        <Button label={t("categories.create")} onPress={() => void create()} />

        <Title>{t("rules.title")}</Title>
        <Body muted>{t("rules.body")}</Body>
        {rules.map((r) => (
          <View
            key={r.id}
            style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
          >
            <Body>
              {t(r.source === "user" ? `rules.${r.match}` : "rules.learned", {
                pattern: r.pattern,
                category: nameOf(r.categoryId),
              })}
            </Body>
            <Button
              label={t("rules.remove")}
              variant="plain"
              onPress={() => void removeRule(db, r.id).then(load)}
            />
          </View>
        ))}
        <ChipRow>
          <Chip
            label={t("rules.byKeyword")}
            selected={match === "keyword"}
            onPress={() => setMatch("keyword")}
          />
          <Chip
            label={t("rules.byMerchant")}
            selected={match === "merchant"}
            onPress={() => setMatch("merchant")}
          />
        </ChipRow>
        <Field
          label={t("rules.pattern")}
          value={pattern}
          onChangeText={setPattern}
          autoCapitalize="none"
        />
        <ChipRow>
          {all.map((c) => (
            <Chip
              key={c.id}
              label={label(c)}
              selected={ruleCategory === c.id}
              onPress={() => setRuleCategory(c.id)}
            />
          ))}
        </ChipRow>
        <Button label={t("rules.add")} onPress={() => void saveRule()} />
        {error ? <Body tone="error">{error}</Body> : null}
        <Button label={t("lock.cancel")} variant="plain" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}
