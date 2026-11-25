import {
  daysBetween,
  INVESTMENT_KINDS,
  type InvestmentKind,
  type Money,
  type Position,
  portfolioSummary,
  positionValue,
  simulateCdt,
} from "@lukas/domain";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";
import { parsePesos } from "../../src/accounts/parse";
import { Progress } from "../../src/components/progress";
import { Chip, ChipRow } from "../../src/components/quick";
import { Body, Button, Field, Screen, Title } from "../../src/components/ui";
import { newId } from "../../src/data/ids";
import { useLocalDatabase } from "../../src/data/provider";
import { parseRate } from "../../src/debts/debts";
import { useDiscreet } from "../../src/display/discreet";
import { formatCivilDate } from "../../src/format/date";
import { formatMoney } from "../../src/format/money";
import { Card } from "../../src/home/home-cards";
import { useI18n } from "../../src/i18n/i18n";
import {
  formatPercentBp,
  listPositions,
  parseCivil,
  parseUnitPrice,
  parseUnits,
  positionProblem,
  removePosition,
  savePosition,
} from "../../src/investments/investments";

interface Draft {
  readonly id: string | null;
  readonly name: string;
  readonly kind: InvestmentKind;
  readonly units: string;
  readonly price: string;
  readonly invested: string;
  readonly openedOn: string;
}

const CDT_TERMS = [90, 180, 360, 540] as const;

const todayCivil = () => {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
};
const civilText = (d: { year: number; month: number; day: number }) =>
  `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
const pesosText = (m: Money) => {
  const cents = m.amountMinor % 100n;
  return `${m.amountMinor / 100n}${cents === 0n ? "" : `,${String(cents).padStart(2, "0")}`}`;
};
const empty = (): Draft => ({
  id: null,
  name: "",
  kind: "cdt",
  units: "1",
  price: "",
  invested: "",
  openedOn: civilText(todayCivil()),
});

/** Inversiones (FIN-601): portafolio con rentabilidad anual, asignación y simulador de CDT. */
export default function Investments() {
  const { t, locale } = useI18n();
  const { discreet } = useDiscreet();
  const database = useLocalDatabase();
  const db = database.status === "ready" ? database.db : null;
  const [positions, setPositions] = useState<Position[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cdtAmount, setCdtAmount] = useState("");
  const [cdtRate, setCdtRate] = useState("");
  const [cdtDays, setCdtDays] = useState<number>(360);
  const fmt = (m: Money) => formatMoney(m, { locale, discreet });

  const load = useCallback(async () => {
    if (db) setPositions(await listPositions(db));
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void load().catch(() => undefined);
    }, [load]),
  );

  const today = todayCivil();
  const summary = portfolioSummary(positions, "COP", today);

  const edit = (p: Position) =>
    setDraft({
      id: p.id,
      name: p.name,
      kind: p.kind,
      units: p.units.replace(/\./g, ","),
      price: pesosText(p.unitPrice),
      invested: pesosText(p.invested),
      openedOn: civilText(p.openedOn),
    });

  const save = async () => {
    if (!db || !draft) return;
    setError(null);
    const units = parseUnits(draft.units);
    const unitPrice = parseUnitPrice(draft.price);
    const invested = parseUnitPrice(draft.invested);
    const openedOn = parseCivil(draft.openedOn);
    if (!units) return setError(t("investments.error.units"));
    if (!unitPrice) return setError(t("investments.error.price"));
    if (!invested) return setError(t("investments.error.invested"));
    if (!openedOn) return setError(t("investments.error.date"));
    const position: Position = {
      id: draft.id ?? newId(),
      name: draft.name,
      kind: draft.kind,
      units,
      unitPrice,
      invested,
      openedOn,
    };
    const problem = positionProblem(position);
    if (problem) return setError(t(`investments.error.${problem}`));
    await savePosition(db, position);
    setDraft(null);
    await load();
  };

  const remove = async (id: string) => {
    if (!db) return;
    await removePosition(db, id);
    setDraft(null);
    await load();
  };

  const cdt = (() => {
    const amount = parsePesos(cdtAmount);
    const rate = parseRate(cdtRate);
    if (!amount || rate === null) return null;
    return simulateCdt({ amount, annualRateBp: rate, days: cdtDays });
  })();

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ gap: 12, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <Title>{t("investments.title")}</Title>
        <Body muted>{t("investments.intro")}</Body>

        {positions.length > 0 ? (
          <Card title={t("investments.portfolio")}>
            <Title>{fmt(summary.value)}</Title>
            <Body>
              {t("investments.gain", {
                gain: fmt(summary.gain),
                invested: fmt(summary.invested),
              })}
            </Body>
            {summary.returnBp !== null ? (
              <Body>{t("investments.return", { pct: formatPercentBp(summary.returnBp) })}</Body>
            ) : null}
            <Body>
              {summary.annualBp !== null
                ? t("investments.annual", { pct: formatPercentBp(summary.annualBp) })
                : t("investments.annualTooSoon")}
            </Body>
            {summary.allocation.map((slice) => (
              <View key={slice.kind} style={{ gap: 4 }}>
                <Body muted>
                  {t("investments.slice", {
                    kind: t(`investments.kind.${slice.kind}`),
                    pct: formatPercentBp(slice.shareBp),
                  })}
                </Body>
                <Progress percent={slice.shareBp / 100} level="ok" />
              </View>
            ))}
          </Card>
        ) : (
          <Body muted>{t("investments.empty")}</Body>
        )}

        {positions.map((p) => {
          const value = positionValue(p);
          const days = Math.max(0, daysBetween(p.openedOn, today));
          const single = portfolioSummary([p], p.invested.currencyCode, today);
          return (
            <Card key={p.id} title={`${p.name} · ${t(`investments.kind.${p.kind}`)}`}>
              <Body>
                {t("investments.positionValue", {
                  value: fmt(value),
                  invested: fmt(p.invested),
                })}
              </Body>
              <Body muted>
                {t("investments.since", {
                  date: formatCivilDate(p.openedOn, locale),
                  days,
                })}
                {single.annualBp !== null
                  ? ` · ${t("investments.annual", { pct: formatPercentBp(single.annualBp) })}`
                  : ""}
              </Body>
              <Button label={t("investments.update")} variant="plain" onPress={() => edit(p)} />
            </Card>
          );
        })}

        {draft ? (
          <Card title={draft.id ? t("investments.editTitle") : t("investments.addTitle")}>
            <View style={{ gap: 8 }}>
              <Field
                label={t("investments.name")}
                value={draft.name}
                onChangeText={(name) => setDraft({ ...draft, name })}
                placeholder="CDT Bancolombia"
              />
              <ChipRow>
                {INVESTMENT_KINDS.map((kind) => (
                  <Chip
                    key={kind}
                    label={t(`investments.kind.${kind}`)}
                    selected={kind === draft.kind}
                    onPress={() => setDraft({ ...draft, kind })}
                  />
                ))}
              </ChipRow>
              <Field
                label={t("investments.units")}
                value={draft.units}
                onChangeText={(units) => setDraft({ ...draft, units })}
                keyboardType="decimal-pad"
              />
              <Field
                label={t("investments.price")}
                value={draft.price}
                onChangeText={(price) => setDraft({ ...draft, price })}
                keyboardType="decimal-pad"
                placeholder="5.200.000"
              />
              <Field
                label={t("investments.invested")}
                value={draft.invested}
                onChangeText={(invested) => setDraft({ ...draft, invested })}
                keyboardType="decimal-pad"
                placeholder="5.000.000"
              />
              <Field
                label={t("investments.openedOn")}
                value={draft.openedOn}
                onChangeText={(openedOn) => setDraft({ ...draft, openedOn })}
                placeholder="2026-01-15"
              />
              {error ? <Body tone="error">{error}</Body> : null}
              <Button label={t("investments.save")} onPress={() => void save()} />
              {draft.id ? (
                <Button
                  label={t("investments.remove")}
                  variant="plain"
                  onPress={() => void remove(draft.id ?? "")}
                />
              ) : null}
              <Button
                label={t("lock.cancel")}
                variant="plain"
                onPress={() => {
                  setDraft(null);
                  setError(null);
                }}
              />
            </View>
          </Card>
        ) : (
          <Button label={t("investments.add")} onPress={() => setDraft(empty())} />
        )}

        <Title>{t("investments.cdtTitle")}</Title>
        <Body muted>{t("investments.cdtIntro")}</Body>
        <Field
          label={t("investments.cdtAmount")}
          value={cdtAmount}
          onChangeText={setCdtAmount}
          keyboardType="number-pad"
          placeholder="10.000.000"
        />
        <Field
          label={t("investments.cdtRate")}
          value={cdtRate}
          onChangeText={setCdtRate}
          keyboardType="decimal-pad"
          placeholder="10,5"
        />
        <ChipRow>
          {CDT_TERMS.map((d) => (
            <Chip
              key={d}
              label={t("investments.cdtDays", { days: d })}
              selected={d === cdtDays}
              onPress={() => setCdtDays(d)}
            />
          ))}
        </ChipRow>
        {cdt ? (
          <Card title={t("investments.cdtResult")}>
            <Title>{fmt(cdt.atMaturity)}</Title>
            <Body>{t("investments.cdtInterest", { amount: fmt(cdt.interest) })}</Body>
            <Body>{t("investments.cdtWithholding", { amount: fmt(cdt.withholding) })}</Body>
            <Body>{t("investments.cdtNet", { amount: fmt(cdt.net) })}</Body>
          </Card>
        ) : null}
        <Body muted>{t("investments.note")}</Body>
      </ScrollView>
    </Screen>
  );
}
