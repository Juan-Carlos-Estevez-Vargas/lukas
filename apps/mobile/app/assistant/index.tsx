import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, type ScrollViewInstance, Text, View } from "react-native";
import { createAssistantClient } from "../../src/assistant/client";
import { e2eAssistantClient } from "../../src/assistant/e2e-client";
import { acceptProposal, editTarget, proposalAmount } from "../../src/assistant/proposals";
import { assistantEnabled, setAssistantEnabled } from "../../src/assistant/settings";
import type { Proposal } from "../../src/assistant/stream";
import { useSession } from "../../src/auth/session";
import { Body, Button, Field, Screen, Title } from "../../src/components/ui";
import { apiUrl, e2eMode } from "../../src/config";
import { newId } from "../../src/data/ids";
import { useLocalDatabase } from "../../src/data/provider";
import { useDiscreet } from "../../src/display/discreet";
import { formatMoney } from "../../src/format/money";
import { Card } from "../../src/home/home-cards";
import type { MessageKey } from "../../src/i18n/es";
import { useI18n } from "../../src/i18n/i18n";
import { useTheme } from "../../src/theme/theme";

type CardState = "pending" | "saving" | "accepted" | "failed";

interface Turn {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly proposals: readonly Proposal[];
}

const POINTS = [
  "assistant.point.data",
  "assistant.point.approve",
  "assistant.point.quota",
  "assistant.point.off",
] as const;

const ERRORS: Record<string, MessageKey> = {
  signed_out: "assistant.error.signedOut",
  quota: "assistant.error.quota",
  unavailable: "assistant.error.unavailable",
  network: "assistant.error.network",
  unexpected: "assistant.error.unexpected",
};

const clock = { newId, now: () => new Date() };

/**
 * Chat con el asistente. Las respuestas solo muestran texto y tarjetas: nada se guarda hasta que
 * la persona toca "Aceptar" (o lo corrige en el formulario con "Editar").
 */
export default function Assistant() {
  const { t, locale } = useI18n();
  const { colors, space, radius, fontSize, fontWeight } = useTheme();
  const { discreet } = useDiscreet();
  const { state } = useSession();
  const database = useLocalDatabase();
  const db = database.status === "ready" ? database.db : null;
  const client = useMemo(
    () => (e2eMode ? e2eAssistantClient() : createAssistantClient(apiUrl)),
    [],
  );
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const scroll = useRef<ScrollViewInstance>(null);

  useEffect(() => {
    if (db) void assistantEnabled(db).then(setEnabled);
  }, [db]);

  if (!db || enabled === null) {
    return (
      <Screen>
        <Body muted>{t("summary.unavailable")}</Body>
      </Screen>
    );
  }

  const toggle = async (on: boolean) => {
    await setAssistantEnabled(db, on);
    setEnabled(on);
    if (!on) setTurns([]);
  };

  if (!enabled) {
    return (
      <Screen>
        <Title>{t("assistant.title")}</Title>
        <ScrollView contentContainerStyle={{ gap: space.md, paddingBottom: space.xl }}>
          <Body>{t("assistant.intro")}</Body>
          <View style={{ gap: space.sm }}>
            {POINTS.map((key) => (
              <Text key={key} style={{ color: colors.text, fontSize: fontSize.body }}>
                {`•  ${t(key)}`}
              </Text>
            ))}
          </View>
          <Button label={t("assistant.enable")} onPress={() => void toggle(true)} />
        </ScrollView>
      </Screen>
    );
  }

  const send = async () => {
    const content = draft.trim();
    if (!content || busy || state.status !== "signedIn") return;
    const next: Turn[] = [...turns, { id: newId(), role: "user", content, proposals: [] }];
    setTurns(next);
    setDraft("");
    setError(null);
    setBusy(true);
    const res = await client.chat(state.token, next);
    setBusy(false);
    if (!res.ok) {
      setError(ERRORS[res.error.kind] ?? "assistant.error.unexpected");
      return;
    }
    const { text, proposals, failed } = res.value;
    if (failed && !text && proposals.length === 0) {
      setError("assistant.error.unexpected");
      return;
    }
    setTurns([
      ...next,
      { id: newId(), role: "assistant", content: text || t("assistant.proposalsOnly"), proposals },
    ]);
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
  };

  const accept = async (proposal: Proposal) => {
    setCards((c) => ({ ...c, [proposal.id]: "saving" }));
    const res = await acceptProposal(db, proposal, clock);
    setCards((c) => ({ ...c, [proposal.id]: res.ok ? "accepted" : "failed" }));
  };

  const bubble = (role: Turn["role"]) => ({
    alignSelf: role === "user" ? ("flex-end" as const) : ("flex-start" as const),
    maxWidth: "88%" as const,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: role === "user" ? colors.primary : colors.surface,
    borderWidth: role === "user" ? 0 : 1,
    borderColor: colors.border,
  });

  return (
    <Screen>
      <Title>{t("assistant.title")}</Title>
      <ScrollView
        ref={scroll}
        contentContainerStyle={{ gap: space.md, paddingBottom: space.md }}
        keyboardShouldPersistTaps="handled"
      >
        {turns.length === 0 ? <Body muted>{t("assistant.empty")}</Body> : null}
        {turns.map((turn) => (
          <View key={turn.id} style={{ gap: space.sm }}>
            <View style={bubble(turn.role)}>
              <Text
                style={{
                  color: turn.role === "user" ? colors.onPrimary : colors.text,
                  fontSize: fontSize.body,
                }}
              >
                {turn.content}
              </Text>
            </View>
            {turn.proposals.map((p) => {
              const status = cards[p.id] ?? "pending";
              const target = editTarget(p);
              const amount = proposalAmount(p);
              return (
                <Card key={p.id} title={t(`assistant.proposal.${p.type}` as MessageKey)}>
                  {amount ? (
                    <Text
                      style={{
                        color: colors.text,
                        fontSize: fontSize.title,
                        fontWeight: fontWeight.bold,
                      }}
                    >
                      {formatMoney(amount, { locale, discreet })}
                    </Text>
                  ) : null}
                  <Body>{p.summary}</Body>
                  {status === "accepted" ? (
                    <Body muted>{t("assistant.proposal.accepted")}</Body>
                  ) : (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                      <Button
                        label={t("assistant.proposal.accept")}
                        busy={status === "saving"}
                        onPress={() => void accept(p)}
                      />
                      <Button
                        label={t("assistant.proposal.edit")}
                        variant="plain"
                        onPress={() =>
                          router.push({ pathname: target.pathname, params: target.params })
                        }
                      />
                    </View>
                  )}
                  {status === "failed" ? (
                    <Body tone="error">{t("assistant.proposal.failed")}</Body>
                  ) : null}
                </Card>
              );
            })}
          </View>
        ))}
        {busy ? <Body muted>{t("assistant.thinking")}</Body> : null}
        {error ? <Body tone="error">{t(error)}</Body> : null}
      </ScrollView>
      <View style={{ gap: space.sm }}>
        <Field
          label={t("assistant.ask")}
          value={draft}
          onChangeText={setDraft}
          placeholder={t("assistant.placeholder")}
          maxLength={2000}
          returnKeyType="send"
          onSubmitEditing={() => void send()}
        />
        <Button label={t("assistant.send")} busy={busy} onPress={() => void send()} />
        <Button label={t("assistant.disable")} variant="plain" onPress={() => void toggle(false)} />
      </View>
    </Screen>
  );
}
