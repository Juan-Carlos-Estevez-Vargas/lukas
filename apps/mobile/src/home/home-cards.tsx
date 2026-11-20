import { Money } from "@lukas/domain";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { Body, Button } from "../components/ui";
import { useDiscreet } from "../display/discreet";
import { formatCivilDate } from "../format/date";
import { formatMoney } from "../format/money";
import { useI18n } from "../i18n/i18n";
import type { AccountProjection } from "../projection/projection";
import { useTheme } from "../theme/theme";
import type { CategorySpend, MonthAvailable, UpcomingPayment } from "./home";

export function Card({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  const { colors, space, radius } = useTheme();
  return (
    <View
      accessibilityRole="summary"
      style={{
        gap: space.xs,
        padding: space.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
      }}
    >
      <Body muted>{title}</Body>
      {children}
    </View>
  );
}

function Line({
  left,
  right,
  warn,
}: {
  readonly left: string;
  readonly right: string;
  readonly warn?: boolean;
}) {
  const { colors, fontSize } = useTheme();
  const style = { color: warn ? colors.warning : colors.text, fontSize: fontSize.body };
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
      <Text style={[style, { flex: 1 }]} numberOfLines={1}>
        {left}
      </Text>
      <Text style={style}>{right}</Text>
    </View>
  );
}

function useMoney() {
  const { locale } = useI18n();
  const { discreet } = useDiscreet();
  return (m: Money) => formatMoney(m, { locale, discreet });
}

/** ¿Cuánto me queda este mes? */
export function AvailableCard({ data }: { readonly data: MonthAvailable }) {
  const { t } = useI18n();
  const { colors, fontSize, fontWeight } = useTheme();
  const money = useMoney();
  const negative = data.available.isNegative();
  return (
    <Card title={t(data.source === "budget" ? "home.availableBudget" : "home.available")}>
      <Text
        style={{
          color: negative ? colors.expense : colors.text,
          fontSize: fontSize.display,
          fontWeight: fontWeight.bold,
        }}
      >
        {money(data.available)}
      </Text>
      <Body muted>
        {negative
          ? t("home.overspent")
          : t("home.perDay", { amount: money(data.perDay), days: String(data.daysLeft) })}
      </Body>
      <Body muted>
        {t("home.flow", { income: money(data.income), expenses: money(data.expenses) })}
      </Body>
    </Card>
  );
}

/** ¿En qué se me va? */
export function TopCategoriesCard({ data }: { readonly data: readonly CategorySpend[] }) {
  const { t } = useI18n();
  const money = useMoney();
  return (
    <Card title={t("home.top")}>
      {data.length === 0 ? <Body muted>{t("home.topEmpty")}</Body> : null}
      {data.map((c) => (
        <Line key={c.id} left={c.icon ? `${c.icon} ${c.name}` : c.name} right={money(c.spent)} />
      ))}
    </Card>
  );
}

/** ¿Qué tengo que pagar pronto? */
export function UpcomingCard({ data }: { readonly data: readonly UpcomingPayment[] }) {
  const { t, locale } = useI18n();
  const money = useMoney();
  return (
    <Card title={t("home.upcoming")}>
      {data.length === 0 ? <Body muted>{t("home.upcomingEmpty")}</Body> : null}
      {data.map((p) => (
        <Line
          key={`${p.kind}:${p.id}`}
          left={`${p.name} · ${formatCivilDate(p.date, locale)}${p.overdue ? ` (${t("home.overdue")})` : ""}`}
          right={money(p.amount)}
          warn={p.overdue}
        />
      ))}
    </Card>
  );
}

/** Aviso de saldo negativo futuro. No se muestra si ninguna cuenta queda en rojo. */
export function ProjectionAlertCard({
  data,
  onOpen,
}: {
  readonly data: readonly AccountProjection[];
  readonly onOpen: (accountId: string) => void;
}) {
  const { t, locale } = useI18n();
  const { colors, fontSize } = useTheme();
  const money = useMoney();
  const first = data[0];
  if (!first) return null;
  return (
    <Card title={t("projection.title")}>
      {data.map((p) =>
        p.firstNegative ? (
          <Text key={p.id} style={{ color: colors.warning, fontSize: fontSize.body }}>
            {`⚠ ${t("projection.alert", {
              account: p.name,
              date: formatCivilDate(p.firstNegative.date, locale),
              amount: money(Money.ofMinor(p.firstNegative.balance, p.currency)),
            })}`}
          </Text>
        ) : null,
      )}
      <Button label={t("projection.see")} variant="plain" onPress={() => onOpen(first.id)} />
    </Card>
  );
}
