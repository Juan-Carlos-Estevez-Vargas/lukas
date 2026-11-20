import { isLegalDocument } from "@lukas/domain";
import { router, useLocalSearchParams } from "expo-router";
import { ScrollView } from "react-native";
import { Button, Screen } from "../../src/components/ui";
import { useI18n } from "../../src/i18n/i18n";
import { LEGAL_TEXTS } from "../../src/legal/documents";
import { LegalTextView } from "../../src/legal/legal-text";

/** `/legal/privacy` y `/legal/terms`: se pueden leer sin sesión, desde el registro. */
export default function LegalDocumentScreen() {
  const { t } = useI18n();
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const text = LEGAL_TEXTS[doc && isLegalDocument(doc) ? doc : "privacy"];
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 40 }}>
        <LegalTextView text={text} since={t("legal.since", { date: text.version })} />
        <Button label={t("legal.back")} variant="plain" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}
