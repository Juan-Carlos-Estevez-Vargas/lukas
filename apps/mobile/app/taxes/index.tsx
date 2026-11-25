import {
  type Account,
  type DeclarationCheck,
  declarationCheck,
  gmfForMonth,
  type Money,
  uvtFor,
} from "@lukas/domain";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView } from "react-native";
import { Progress } from "../../src/components/progress";
import { Chip, ChipRow } from "../../src/components/quick";
import { Body, Screen, Title } from "../../src/components/ui";
import { sqliteAccounts } from "../../src/data/ledger-sqlite";
import { useLocalDatabase } from "../../src/data/provider";
import { useDiscreet } from "../../src/display/discreet";
import { formatMoney } from "../../src/format/money";
import { Card } from "../../src/home/home-cards";
import { useI18n } from "../../src/i18n/i18n";
import {
  exemptAccount,
  gmfOutflows,
  hasForeignAccounts,
  setExemptAccount,
  taxFigures,
} from "../../src/taxes/taxes";

/** Ayuda tributaria (FIN-604): si debes declarar renta, cifras para la declaración y 4×1000. */
export default function Taxes() {
  const { t, locale } = useI18n();
  const { discreet } = useDiscreet();
  const database = useLocalDatabase();
  const db = database.status === "ready" ? database.db : null;
  const now = new Date();
  // En 2026 se declara el año gravable 2025.
  const [year, setYear] = useState(now.getFullYear() - 1);
  const [check, setCheck] = useState<DeclarationCheck | null>(null);
  const [foreign, setForeign] = useState(false);
  const [banks, setBanks] = useState<Account[]>([]);
  const [exempt, setExempt] = useState<string | null>(null);
  const [gmf, setGmf] = useState<Money | null>(null);
  const fmt = (m: Money) => formatMoney(m, { locale, discreet });

  const load = useCallback(async () => {
    if (!db) return;
    setCheck(declarationCheck(year, await taxFigures(db, year)));
    setForeign(await hasForeignAccounts(db));
    const accounts = await sqliteAccounts(db).list({ includeArchived: false });
    setBanks(accounts.filter((a) => a.type === "bank" && a.currency === "COP"));
    setExempt(await exemptAccount(db));
    const thisYear = new Date().getFullYear();
    const month = new Date().getMonth() + 1;
    setGmf(gmfForMonth(thisYear, await gmfOutflows(db, thisYear, month)));
  }, [db, year]);

  useFocusEffect(
    useCallback(() => {
      void load().catch(() => undefined);
    }, [load]),
  );

  const years = [now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear()].filter(
    (y) => uvtFor(y) !== null,
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 40 }}>
        <Title>{t("taxes.title")}</Title>
        <Body muted>{t("taxes.intro")}</Body>
        <ChipRow>
          {years.map((y) => (
            <Chip
              key={y}
              label={t("taxes.year", { year: y })}
              selected={y === year}
              onPress={() => setYear(y)}
            />
          ))}
        </ChipRow>
        {check?.ok ? (
          <>
            <Card title={t("taxes.verdictTitle", { year })}>
              <Title>{t(check.mustDeclare ? "taxes.mustDeclare" : "taxes.noDeclare")}</Title>
              <Body muted>
                {t(check.mustDeclare ? "taxes.mustDeclareHelp" : "taxes.noDeclareHelp", {
                  next: year + 1,
                })}
              </Body>
            </Card>
            {check.checks.map((c) => (
              <Card key={c.criterion} title={t(`taxes.criterion.${c.criterion}`)}>
                <Body>{t("taxes.valueOf", { value: fmt(c.value), limit: fmt(c.limit) })}</Body>
                <Progress
                  percent={c.percent}
                  level={c.exceeds ? "over" : c.percent >= 80 ? "warning" : "ok"}
                />
              </Card>
            ))}
          </>
        ) : check ? (
          <Body tone="error">{t("taxes.unknownYear")}</Body>
        ) : null}
        {foreign ? <Body muted>{t("taxes.foreign")}</Body> : null}

        <Title>{t("taxes.gmfTitle")}</Title>
        <Body muted>{t("taxes.gmfIntro")}</Body>
        {gmf ? <Body>{t("taxes.gmfMonth", { amount: fmt(gmf) })}</Body> : null}
        {banks.length > 0 ? (
          <>
            <Body muted>{t("taxes.gmfExempt")}</Body>
            <ChipRow>
              <Chip
                label={t("taxes.gmfNone")}
                selected={exempt === null}
                onPress={() => db && void setExemptAccount(db, null).then(load)}
              />
              {banks.map((b) => (
                <Chip
                  key={b.id}
                  label={b.name}
                  selected={b.id === exempt}
                  onPress={() => db && void setExemptAccount(db, b.id).then(load)}
                />
              ))}
            </ChipRow>
          </>
        ) : null}
        <Body muted>{t("taxes.disclaimer")}</Body>
      </ScrollView>
    </Screen>
  );
}
