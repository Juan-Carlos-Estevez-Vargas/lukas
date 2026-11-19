import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../theme/theme";

export function Screen({ children }: { readonly children: ReactNode }) {
  const { colors, space } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flex: 1, padding: space.lg, gap: space.md }}>{children}</View>
    </SafeAreaView>
  );
}

export function Title({ children }: { readonly children: ReactNode }) {
  const { colors, fontSize, fontWeight } = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={{ color: colors.text, fontSize: fontSize.display, fontWeight: fontWeight.bold }}
    >
      {children}
    </Text>
  );
}

export function Body({
  children,
  muted = false,
  tone,
}: {
  readonly children: ReactNode;
  readonly muted?: boolean;
  readonly tone?: "error";
}) {
  const { colors, fontSize } = useTheme();
  const color = tone === "error" ? colors.expense : muted ? colors.textMuted : colors.text;
  return (
    <Text
      accessibilityLiveRegion={tone === "error" ? "polite" : "none"}
      style={{ color, fontSize: fontSize.body, lineHeight: fontSize.body * 1.4 }}
    >
      {children}
    </Text>
  );
}

export function Button({
  label,
  onPress,
  busy = false,
  variant = "primary",
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly busy?: boolean;
  readonly variant?: "primary" | "plain";
}) {
  const { colors, space, radius, fontSize, fontWeight } = useTheme();
  const primary = variant === "primary";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: space.lg,
        borderRadius: radius.md,
        backgroundColor: primary ? colors.primary : "transparent",
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator color={primary ? colors.onPrimary : colors.primary} />
      ) : (
        <Text
          style={{
            color: primary ? colors.onPrimary : colors.primary,
            fontSize: fontSize.body,
            fontWeight: fontWeight.medium,
          }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Field({ label, ...input }: { readonly label: string } & TextInputProps) {
  const { colors, space, radius, fontSize } = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      <Text style={{ color: colors.textMuted, fontSize: fontSize.caption }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        style={{
          minHeight: 48,
          paddingHorizontal: space.md,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          backgroundColor: colors.surface,
          color: colors.text,
          fontSize: fontSize.body,
        }}
        {...input}
      />
    </View>
  );
}

export function Loading() {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.background,
      }}
    >
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}
