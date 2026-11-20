import type { LegalDocument } from "@lukas/domain";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState, ScrollView, StyleSheet, View } from "react-native";
import { useSession } from "../auth/session";
import { Body, Button, Screen, Title } from "../components/ui";
import { apiUrl, e2eMode } from "../config";
import { useLocalDatabase } from "../data/provider";
import { useI18n } from "../i18n/i18n";
import { useTheme } from "../theme/theme";
import { acceptNow, createConsentClient, resolveConsent } from "./consent";
import { LEGAL_TEXTS } from "./documents";
import { LegalTextView } from "./legal-text";

/**
 * Con sesión, revisa que la API tenga la autorización vigente. Si la persona la aceptó al
 * registrarse en este teléfono se envía sola; si no (otro teléfono, o cambió la versión), tapa la
 * app con los documentos hasta que los acepte. Sin red no bloquea.
 */
export function ConsentGate() {
  const { t } = useI18n();
  const { colors, space } = useTheme();
  const { state: session } = useSession();
  const database = useLocalDatabase();
  const client = useMemo(() => createConsentClient(apiUrl), []);
  const [status, setStatus] = useState<"ok" | "ask" | "offline" | "checking">("checking");
  const [open, setOpen] = useState<LegalDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const token = session.status === "signedIn" && !e2eMode ? session.token : null;

  const check = useCallback(() => {
    if (!token || database.status !== "ready") return;
    void resolveConsent(database.db, client, token)
      .then(setStatus)
      .catch(() => setStatus("offline"));
  }, [token, database, client]);

  useEffect(() => {
    setStatus("checking");
    check();
  }, [check]);

  useEffect(() => {
    if (status !== "offline") return;
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") check();
    });
    return () => sub.remove();
  }, [status, check]);

  if (!token || status !== "ask" || database.status !== "ready") return null;
  const { db } = database;

  const accept = async () => {
    setBusy(true);
    setFailed(false);
    const ok = await acceptNow(db, client, token);
    setBusy(false);
    if (ok) setStatus("ok");
    else setFailed(true);
  };

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}>
      <Screen>
        <ScrollView contentContainerStyle={{ gap: space.md, paddingBottom: 40 }}>
          <Title>{t("legal.gate.title")}</Title>
          <Body>{t("legal.gate.body")}</Body>
          {(["privacy", "terms"] as const).map((doc) => (
            <View key={doc} style={{ gap: space.sm }}>
              <Button
                variant="plain"
                label={t(doc === "privacy" ? "legal.privacy" : "legal.terms")}
                onPress={() => setOpen(open === doc ? null : doc)}
              />
              {open === doc ? (
                <LegalTextView
                  text={LEGAL_TEXTS[doc]}
                  since={t("legal.since", { date: LEGAL_TEXTS[doc].version })}
                />
              ) : null}
            </View>
          ))}
          {failed ? <Body tone="error">{t("legal.gate.offline")}</Body> : null}
          <Button label={t("legal.gate.accept")} busy={busy} onPress={() => void accept()} />
        </ScrollView>
      </Screen>
    </View>
  );
}
