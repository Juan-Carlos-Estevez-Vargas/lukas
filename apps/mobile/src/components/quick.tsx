import { Pressable, ScrollView, Text, View } from "react-native";
import type { KeypadKey } from "../movements/keypad";
import { useTheme } from "../theme/theme";

/** Opción compacta en fila horizontal (categoría, cuenta, comercio). */
export function Chip({
  label,
  selected = false,
  onPress,
  onLongPress,
  hint,
  testID,
}: {
  readonly label: string;
  readonly selected?: boolean;
  readonly onPress: () => void;
  readonly onLongPress?: () => void;
  /** Para el lector de pantalla, cuando el chip hace algo más que elegir (p. ej. borrar). */
  readonly hint?: string;
  readonly testID?: string;
}) {
  const { colors, space, radius, fontSize, fontWeight } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityHint={hint}
      onPress={onPress}
      onLongPress={onLongPress}
      style={{
        minHeight: 44,
        justifyContent: "center",
        paddingHorizontal: space.md,
        borderRadius: radius.pill,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: colors.surface,
      }}
    >
      <Text
        style={{
          color: colors.text,
          fontSize: fontSize.body,
          fontWeight: selected ? fontWeight.medium : fontWeight.regular,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function ChipRow({
  children,
  testID,
}: {
  readonly children: React.ReactNode;
  readonly testID?: string;
}) {
  const { space } = useTheme();
  return (
    <ScrollView
      testID={testID}
      horizontal
      // En la web un ScrollView crece a todo el alto disponible; la fila solo mide lo que sus chips.
      style={{ flexGrow: 0 }}
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: space.sm }}
    >
      {children}
    </ScrollView>
  );
}

const ROWS: readonly (readonly KeypadKey[])[] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["000", "0", "back"],
];

/** Teclado numérico propio: teclas grandes, sin abrir el teclado del sistema. */
export function Keypad({
  onKey,
  backLabel,
}: {
  readonly onKey: (key: KeypadKey) => void;
  readonly backLabel: string;
}) {
  const { colors, space, radius, fontSize, fontWeight } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      {ROWS.map((row) => (
        <View key={row.join()} style={{ flexDirection: "row", gap: space.sm }}>
          {row.map((key) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={key === "back" ? backLabel : key}
              onPress={() => onKey(key)}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 52,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.md,
                backgroundColor: pressed ? colors.border : colors.surface,
              })}
            >
              <Text
                style={{
                  color: colors.text,
                  fontSize: fontSize.title,
                  fontWeight: fontWeight.medium,
                }}
              >
                {key === "back" ? "⌫" : key}
              </Text>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

/** Botón flotante para registrar un movimiento desde cualquier lista. */
export function Fab({ label, onPress }: { readonly label: string; readonly onPress: () => void }) {
  const { colors, space, radius, fontSize, fontWeight } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        position: "absolute",
        right: space.lg,
        bottom: space.lg,
        width: 56,
        height: 56,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.pill,
        backgroundColor: colors.primary,
        opacity: pressed ? 0.85 : 1,
        elevation: 4,
      })}
    >
      <Text
        style={{
          color: colors.onPrimary,
          fontSize: fontSize.display,
          fontWeight: fontWeight.medium,
        }}
      >
        +
      </Text>
    </Pressable>
  );
}
