import { PRICES, TRIAL_DAYS } from "@lukas/domain";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Platform, ScrollView } from "react-native";
import { civilDate } from "../../src/accounts/credit-card";
import { useSession } from "../../src/auth/session";
import {
  type BillingError,
  type BillingStatus,
  createBillingClient,
  createCheckout,
  rememberEntitlements,
} from "../../src/billing/plans";
import { useEntitlements } from "../../src/billing/use-entitlements";
import { Body, Button, Field, Screen, Title } from "../../src/components/ui";
import { apiUrl, e2eMode } from "../../src/config";
import { useLocalDatabase } from "../../src/data/provider";
import { formatCivilDate } from "../../src/format/date";
import { formatMoney } from "../../src/format/money";
import type { MessageKey } from "../../src/i18n/es";
import { useI18n } from "../../src/i18n/i18n";
import { useTheme } from "../../src/theme/theme";

const ERRORS: Record<BillingError, MessageKey> = {
  signed_out: "assistant.error.signedOut",
  trial_unavailable: "premium.error.trial",
  coupon_unknown: "premium.error.couponUnknown",
  coupon_used: "premium.error.couponUsed",
  coupon_expired: "premium.error.couponExpired",
  coupon_exhausted: "premium.error.couponExhausted",
  rate_limited: "premium.error.rateLimited",
  unavailable: "assistant.error.unavailable",
  network: "assistant.error.network",
  unexpected: "assistant.error.unexpected",
};

const STATUS_TEXT: Record<NonNullable<BillingStatus["subscription"]>["status"], MessageKey> = {
  trialing: "premium.status.trialing",
  active: "premium.status.active",
  past_due: "premium.status.pastDue",
  canceled: "premium.status.canceled",
  expired: "premium.status.expired",
};

/** Planes: qué trae premium, cuánto cuesta, la prueba de 14 días y los cupones. */
export default function Premium() {
  const { t, locale } = useI18n();
  const { space } = useTheme();
  const { state: session } = useSession();
  const database = useLocalDatabase();
  const { refresh } = useEntitlements();
  const client = useMemo(() => createBillingClient(apiUrl), []);
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [notice, setNotice] = useState<MessageKey | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"trial" | "coupon" | `pay:${string}` | null>(null);
  const token = session.status === "signedIn" && !e2eMode ? session.token : null;

  const apply = useCallback(
    async (next: BillingStatus) => {
      setStatus(next);
      if (database.status === "ready") await rememberEntitlements(database.db, next.entitlements);
      refresh();
    },
    [database, refresh],
  );

  useEffect(() => {
    if (!token) return;
    void client.status(token).then((res) => {
      if (res.ok) void apply(res.value);
      else setError(ERRORS[res.error]);
    });
  }, [client, token, apply]);

  const run = async (kind: "trial" | "coupon") => {
    if (!token || busy) return;
    setBusy(kind);
    setError(null);
    setNotice(null);
    const res =
      kind === "trial" ? await client.startTrial(token) : await client.redeem(token, code);
    setBusy(null);
    if (!res.ok) return setError(ERRORS[res.error]);
    await apply(res.value);
    setCode("");
    setNotice(kind === "trial" ? "premium.trial.started" : "premium.coupon.redeemed");
  };

  // Wompi solo en la web: en Android las compras digitales van por la tienda (RevenueCat).
  const pay = async (priceId: string) => {
    if (!token || busy) return;
    setBusy(`pay:${priceId}`);
    setError(null);
    const res = await createCheckout(apiUrl, token, priceId);
    setBusy(null);
    if (!res.ok) {
      return setError(res.error === "unavailable" ? "premium.pay.unavailable" : ERRORS[res.error]);
    }
    await Linking.openURL(res.url);
  };

  const sub = status?.subscription ?? null;
  const until = sub ? formatCivilDate(civilDate(sub.periodEnd), locale) : "";

  return (
    <Screen>
      <Title>{t("premium.title")}</Title>
      <ScrollView contentContainerStyle={{ gap: space.md }} keyboardShouldPersistTaps="handled">
        <Body>{t("premium.intro")}</Body>
        <Body>{t("premium.feature.receipts")}</Body>
        <Body>{t("premium.feature.search")}</Body>
        <Body>{t("premium.feature.quota")}</Body>
        {PRICES.map((price) => (
          <Body key={price.id} muted>
            {t(price.period === "month" ? "premium.price.month" : "premium.price.year", {
              amount: formatMoney(price.amount, { locale, discreet: false }),
            })}
          </Body>
        ))}
        {sub ? <Body>{t(STATUS_TEXT[sub.status], { date: until })}</Body> : null}
        {status?.trialAvailable ? (
          <Button
            label={t("premium.trial.start", { days: String(TRIAL_DAYS) })}
            busy={busy === "trial"}
            onPress={() => void run("trial")}
          />
        ) : null}
        {Platform.OS === "web" && token ? (
          <>
            {PRICES.map((price) => (
              <Button
                key={price.id}
                label={t("premium.pay.wompi", {
                  amount: formatMoney(price.amount, { locale, discreet: false }),
                })}
                busy={busy === `pay:${price.id}`}
                onPress={() => void pay(price.id)}
              />
            ))}
            <Body muted>{t("premium.pay.wompiNote")}</Body>
          </>
        ) : (
          <Body muted>{t("premium.pay.soon")}</Body>
        )}
        <Field
          label={t("premium.coupon.label")}
          value={code}
          onChangeText={setCode}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={32}
          returnKeyType="done"
          onSubmitEditing={() => void run("coupon")}
        />
        <Button
          label={t("premium.coupon.redeem")}
          variant="plain"
          busy={busy === "coupon"}
          onPress={() => void run("coupon")}
        />
        {notice ? <Body>{t(notice)}</Body> : null}
        {error ? <Body tone="error">{t(error)}</Body> : null}
        {!token && !e2eMode ? <Body muted>{t("premium.signedOut")}</Body> : null}
      </ScrollView>
    </Screen>
  );
}
