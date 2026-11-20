import { View } from "react-native";
import { Body, Title } from "../components/ui";
import { useTheme } from "../theme/theme";
import type { LegalText } from "./documents";

/** Un documento legal completo: título, vigencia y secciones. */
export function LegalTextView({
  text,
  since,
}: {
  readonly text: LegalText;
  readonly since: string;
}) {
  const { space } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <Title>{text.title}</Title>
      <Body muted>{since}</Body>
      {text.sections.map((section) => (
        <View key={section.title} style={{ gap: space.xs }}>
          <Body>{section.title}</Body>
          {section.paragraphs.map((p) => (
            <Body key={p} muted>
              {p}
            </Body>
          ))}
        </View>
      ))}
    </View>
  );
}
