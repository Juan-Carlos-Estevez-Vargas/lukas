import { isCurrencyCode, Money } from "@lukas/domain";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { civilDate } from "../../src/accounts/credit-card";
import {
  createSearchClient,
  type SearchError,
  type SearchResult,
} from "../../src/assistant/search";
import { useSession } from "../../src/auth/session";
import { Body, Button, Field, Screen, Title } from "../../src/components/ui";
import { apiUrl } from "../../src/config";
import { useDiscreet } from "../../src/display/discreet";
import { formatShortDate } from "../../src/format/date";
import { formatMoney } from "../../src/format/money";
import type { MessageKey } from "../../src/i18n/es";
import { useI18n } from "../../src/i18n/i18n";
import { useTheme } from "../../src/theme/theme";

const ERRORS: Record<SearchError, MessageKey> = {
  signed_out: "assistant.error.signedOut",
  quota: "assistant.error.quota",
  premium: "assistant.error.premium",
  unavailable: "assistant.error.unavailable",
  network: "assistant.error.network",
  unexpected: "assistant.error.unexpected",
};

/** Busca movimientos por lo que significan ("salidas a comer"), no por el texto exacto. */
export default function SemanticSearch() {
  const { t, locale } = useI18n();
  const { colors, space } = useTheme();
  const { discreet } = useDiscreet();
  const { state } = useSession();
  const client = useMemo(() => createSearchClient(apiUrl), []);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<readonly SearchResult[] | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);

  const search = async () => {
    if (query.trim().length < 2 || busy || state.status !== "signedIn") return;
    setBusy(true);
    setError(null);
    const res = await client.search(state.token, query);
    setBusy(false);
    if (!res.ok) return setError(ERRORS[res.error]);
    setResults(res.value);
  };

  const amountOf = (r: SearchResult) => {
    if (!r.amount || !isCurrencyCode(r.amount.currency)) return "";
    const money = Money.parse(r.amount.amount, r.amount.currency);
    return money.ok ? formatMoney(money.value, { locale, discreet }) : "";
  };

  return (
    <Screen>
      <Title>{t("search.title")}</Title>
      <ScrollView contentContainerStyle={{ gap: space.md }} keyboardShouldPersistTaps="handled">
        <Body muted>{t("search.intro")}</Body>
        <Field
          label={t("search.query")}
          value={query}
          onChangeText={setQuery}
          placeholder={t("search.placeholder")}
          maxLength={200}
          returnKeyType="search"
          onSubmitEditing={() => void search()}
        />
        <Button label={t("search.go")} busy={busy} onPress={() => void search()} />
        {error ? <Body tone="error">{t(error)}</Body> : null}
        {results && results.length === 0 ? <Body muted>{t("search.empty")}</Body> : null}
        {results?.map((r) => (
          <Pressable
            key={r.id}
            accessibilityRole="button"
            onPress={() => router.push(`/movement/${r.id}`)}
            style={{
              minHeight: 48,
              paddingVertical: space.sm,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              flexDirection: "row",
              justifyContent: "space-between",
              gap: space.md,
            }}
          >
            <View style={{ flex: 1 }}>
              <Body>{r.merchant || r.description || r.category || t("search.noName")}</Body>
              <Body muted>
                {[formatShortDate(civilDate(r.date), locale), r.category]
                  .filter(Boolean)
                  .join(" · ")}
              </Body>
            </View>
            <Body>{amountOf(r)}</Body>
          </Pressable>
        ))}
      </ScrollView>
    </Screen>
  );
}
