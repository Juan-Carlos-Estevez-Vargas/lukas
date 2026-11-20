import { LEVELS, layoutCalendar } from "@lukas/charts";
import { useMemo, useState } from "react";
import { Platform, Text, View } from "react-native";
import Svg, { G, Rect, Text as SvgText } from "react-native-svg";

export interface HeatmapChartProps {
  readonly year: number;
  readonly month: number;
  /** Gasto por día en unidades menores; posición 0 = día 1. */
  readonly values: readonly bigint[];
  /** Iniciales de lunes a domingo. */
  readonly weekdays: readonly string[];
  readonly color: string;
  readonly emptyColor: string;
  readonly textColor: string;
  /** Texto sobre los días de más gasto, donde el color es fuerte. */
  readonly strongTextColor: string;
  readonly selected: number | null;
  readonly onSelect: (day: number) => void;
  readonly description: string;
  readonly testID?: string;
}

const GAP = 4;
/** Celdas de hasta 48 px: en el escritorio el calendario no ocupa toda la tarjeta. */
const MAX_WIDTH = 7 * 48 + 6 * GAP;
/** En la web el texto de un SVG sale con letra serif si no se le dice otra cosa. */
const FONT = Platform.OS === "web" ? { fontFamily: "system-ui, sans-serif" } : {};

/** Calendario del mes con el gasto de cada día como intensidad del color. */
export function HeatmapChart(props: HeatmapChartProps) {
  const { year, month, values, weekdays, color, emptyColor, textColor, strongTextColor } = props;
  const { selected, onSelect } = props;
  const [width, setWidth] = useState(0);
  const layout = useMemo(
    () => layoutCalendar(year, month, values, { width, gap: GAP }),
    [year, month, values, width],
  );

  return (
    <View
      testID={props.testID}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityLabel={props.description}
      style={{ width: "100%", maxWidth: MAX_WIDTH }}
    >
      <View style={{ flexDirection: "row", gap: GAP, marginBottom: GAP }}>
        {weekdays.map((d, i) => (
          <Text
            // biome-ignore lint/suspicious/noArrayIndexKey: las iniciales se repiten (martes y miércoles).
            key={i}
            style={{ width: layout.cellSize, textAlign: "center", color: textColor, fontSize: 11 }}
          >
            {d}
          </Text>
        ))}
      </View>
      {width > 0 ? (
        <Svg width={width} height={layout.height}>
          {layout.cells.map((cell) => (
            <G key={cell.day} onPress={() => onSelect(cell.day)}>
              <Rect
                x={cell.x}
                y={cell.y}
                width={cell.size}
                height={cell.size}
                rx={4}
                fill={cell.level === 0 ? emptyColor : color}
                fillOpacity={cell.level === 0 ? 1 : 0.2 + (0.8 * cell.level) / LEVELS}
                stroke={cell.day === selected ? textColor : "none"}
                strokeWidth={2}
              />
              <SvgText
                x={cell.x + cell.size / 2}
                y={cell.y + cell.size / 2 + 4}
                fontSize={11}
                {...FONT}
                textAnchor="middle"
                fill={cell.level >= 3 ? strongTextColor : textColor}
              >
                {String(cell.day)}
              </SvgText>
            </G>
          ))}
        </Svg>
      ) : null}
    </View>
  );
}
