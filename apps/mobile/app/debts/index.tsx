import {
  type DebtStrategy,
  freedomMonth,
  Money,
  planDebts,
  prepaymentSavings,
} from "@lukas/domain";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { parsePesos } from "../../src/accounts/parse";
import { Chip, ChipRow } from "../../src/components/quick";
import { Body, Button, Field, Screen, Title } from "../../src/components/ui";
import { useLocalDatabase } from "../../src/data/provider";
import {
  type DebtRow,
  debtsForPlan,
  formatRate,
  loadDebts,
  parseRate,
  saveTerms,
} from "../../src/debts/debts";
import { useDiscreet } from "../../src/display/discreet";
import { formatMonth } from "../../src/format/date";
import { formatMoney } from "../../src/format/money";
import { Card } from "../../src/home/home-cards";
import { useI18n } from "../../src/i18n/i18n";

interface Draft {
  readonly rate: string;
  readonly min: string;
}

const pesos = (m: Money) => (m.amountMinor / 100n).toString();

/** Deudas (FIN-602): bola de nieve o avalancha, fecha de libertad y abonos a capital. */
export default function Debts() {
  const { t, locale } = useI18n();
  const { discreet } = useDiscreet();
  const database = useLocalDatabase();
  const db = database.status === "ready" ? database.db : null;
  const [rows, setRows] = useState<DebtRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [budget, setBudget] = useState("");
  const [strategy, setStrategy] = useState<DebtStrategy>("avalanche");
  const [target, setTarget] = useState<string | null>(null);
  const [extra, setExtra] = useState("");
  const [lump, setLump] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fmt = (m: Money) => formatMoney(m, { locale, discreet });

  const load = useCallback(async () => {
    if (!db) return;
    const loaded = await loadDebts(db);
    setRows(loaded);
    setDrafts(
      Object.fromEntries(
        loaded.map((r) => [
          r.account.id,
          {
            rate: r.terms ? formatRate(r.terms.annualRateBp) : "",
            min: r.terms ? pesos(Money.ofMinor(BigInt(r.terms.minPaymentMinor), "COP")) : "",
          },
        ]),
      ),
    );
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void load().catch(() => undefined);
    }, [load]),
  );

  const save = async () => {
    if (!db) return;
    setError(null);
    for (const row of rows) {
      const draft = drafts[row.account.id];
      if (!draft || (draft.rate === "" && draft.min === "")) continue;
      const rate = parseRate(draft.rate);
      const min = parsePesos(draft.min);
      if (rate === null || !min || min.isNegative()) {
        return setError(t("debts.invalid", { name: row.account.name }));
      }
      await saveTerms(db, row.account.id, {
        annualRateBp: rate,
        minPaymentMinor: min.amountMinor.toString(),
      });
    }
    await load();
  };

  const { debts, missingTerms } = useMemo(() => debtsForPlan(rows), [rows]);
  const minimums = debts.reduce((a, d) => a.add(d.minPayment), Money.zero("COP"));
  const monthly = parsePesos(budget) ?? minimums;
  const plans = useMemo(
    () =>
      monthly
        ? {
            snowball: planDebts(debts, monthly, "snowball"),
            avalanche: planDebts(debts, monthly, "avalanche"),
          }
        : null,
    [debts, monthly],
  );
  const plan = plans?.[strategy];
  const now = new Date();
  const today = { year: now.getFullYear(), month: now.getMonth() + 1 };
  const nameOf = (id: string) => rows.find((r) => r.account.id === id)?.account.name ?? "";

  const chosen = debts.find((d) => d.id === target) ?? debts[0];
  const savings = chosen
    ? prepaymentSavings(chosen, {
        monthlyExtra: parsePesos(extra) ?? Money.zero("COP"),
        lumpSum: parsePesos(lump) ?? Money.zero("COP"),
      })
    : null;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ gap: 12, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <Title>{t("debts.title")}</Title>
        <Body muted>{t("debts.intro")}</Body>
        {rows.length === 0 ? <Body muted>{t("debts.empty")}</Body> : null}
        {rows.map((row) => {
          const draft = drafts[row.account.id] ?? { rate: "", min: "" };
          const set = (patch: Partial<Draft>) =>
            setDrafts((d) => ({ ...d, [row.account.id]: { ...draft, ...patch } }));
          return (
            <Card key={row.account.id} title={row.account.name}>
              <Body>{t("debts.owed", { amount: fmt(row.owed) })}</Body>
              <View style={{ gap: 8 }}>
                <Field
                  label={t("debts.rate")}
                  value={draft.rate}
                  onChangeText={(rate) => set({ rate })}
                  keyboardType="decimal-pad"
                  placeholder="28,99"
                />
                <Field
                  label={t("debts.minPayment")}
                  value={draft.min}
                  onChangeText={(min) => set({ min })}
                  keyboardType="number-pad"
                  placeholder="150.000"
                />
              </View>
            </Card>
          );
        })}
        {rows.length > 0 ? (
          <Button label={t("debts.save")} variant="plain" onPress={() => void save()} />
        ) : null}
        {error ? <Body tone="error">{error}</Body> : null}
        {missingTerms.length > 0 ? (
          <Body muted>
            {t("debts.missing", { names: missingTerms.map((r) => r.account.name).join(", ") })}
          </Body>
        ) : null}

        {debts.length > 0 ? (
          <>
            <Title>{t("debts.planTitle")}</Title>
            <Field
              label={t("debts.budget")}
              value={budget}
              onChangeText={setBudget}
              keyboardType="number-pad"
              placeholder={pesos(minimums)}
            />
            <ChipRow>
              {(["avalanche", "snowball"] as const).map((s) => (
                <Chip
                  key={s}
                  label={t(`debts.strategy.${s}`)}
                  selected={s === strategy}
                  onPress={() => setStrategy(s)}
                />
              ))}
            </ChipRow>
            <Body muted>{t(`debts.strategyHelp.${strategy}`)}</Body>
            {plan?.ok ? (
              <Card title={t("debts.freedom")}>
                <Title>{formatMonth(freedomMonth(today, plan.months), locale, "long")}</Title>
                <Body>
                  {t("debts.summary", {
                    months: plan.months,
                    interest: fmt(plan.totalInterest),
                  })}
                </Body>
                {plan.payoffs.map((p, i) => (
                  <Body key={p.id} muted>
                    {t("debts.payoff", {
                      n: i + 1,
                      name: nameOf(p.id),
                      date: formatMonth(freedomMonth(today, p.month), locale, "long"),
                    })}
                  </Body>
                ))}
              </Card>
            ) : plan ? (
              <Body tone="error">{t(`debts.error.${plan.reason}`)}</Body>
            ) : null}
            {plans?.snowball.ok && plans.avalanche.ok ? (
              <Body muted>
                {t("debts.compare", {
                  amount: fmt(plans.snowball.totalInterest.subtract(plans.avalanche.totalInterest)),
                })}
              </Body>
            ) : null}

            <Title>{t("debts.prepayTitle")}</Title>
            <Body muted>{t("debts.prepayIntro")}</Body>
            <ChipRow>
              {debts.map((d) => (
                <Chip
                  key={d.id}
                  label={d.name}
                  selected={d.id === chosen?.id}
                  onPress={() => setTarget(d.id)}
                />
              ))}
            </ChipRow>
            <Field
              label={t("debts.extra")}
              value={extra}
              onChangeText={setExtra}
              keyboardType="number-pad"
              placeholder="100.000"
            />
            <Field
              label={t("debts.lump")}
              value={lump}
              onChangeText={setLump}
              keyboardType="number-pad"
              placeholder="0"
            />
            {savings?.ok ? (
              <Body>
                {t("debts.saved", {
                  months: savings.monthsSaved,
                  interest: fmt(savings.interestSaved),
                })}
              </Body>
            ) : savings ? (
              <Body tone="error">{t(`debts.error.${savings.reason}`)}</Body>
            ) : null}
          </>
        ) : null}
        <Body muted>{t("debts.note")}</Body>
      </ScrollView>
    </Screen>
  );
}
