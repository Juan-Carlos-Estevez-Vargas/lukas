import type { BudgetLevel } from "@lukas/domain";
import { View } from "react-native";
import { useTheme } from "../theme/theme";

/** Barra de avance; el color cambia al 80 % y al 100 %. */
export function Progress({
  percent,
  level,
}: {
  readonly percent: number;
  readonly level: BudgetLevel;
}) {
  const { colors, radius } = useTheme();
  const color =
    level === "over" ? colors.expense : level === "warning" ? colors.warning : colors.primary;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.min(percent, 100) }}
      style={{ height: 8, borderRadius: radius.md, backgroundColor: colors.border }}
    >
      <View
        style={{
          width: `${Math.min(percent, 100)}%`,
          height: 8,
          borderRadius: radius.md,
          backgroundColor: color,
        }}
      />
    </View>
  );
}
