import { layoutLine, linePath } from "@lukas/charts";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import Svg, { Circle, Line, Path } from "react-native-svg";
import type { LineChartProps } from "./types";

/** Línea con SVG; el cero se marca para ver cuándo el patrimonio fue negativo. */
export function LineChart(props: LineChartProps) {
  const { labels, values, color, height, description, gridColor, textColor } = props;
  const every = Math.max(1, props.labelEvery ?? 1);
  const [width, setWidth] = useState(0);
  // Margen para que los puntos de los extremos no queden cortados.
  const pad = 6;
  const layout = useMemo(
    () => layoutLine(values, { width: Math.max(0, width - pad * 2), height: height - pad * 2 }),
    [values, width, height],
  );
  const points = layout.points.map((p) => ({ x: p.x + pad, y: p.y + pad }));

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="image"
      accessibilityLabel={description}
    >
      {width > 0 ? (
        <Svg width={width} height={height}>
          <Line
            x1={0}
            y1={layout.zeroY + pad}
            x2={width}
            y2={layout.zeroY + pad}
            stroke={gridColor}
            strokeWidth={1}
          />
          <Path d={linePath(points)} stroke={color} fill="none" strokeWidth={2.5} />
          {points.map((p, i) => (
            <Circle key={labels[i] ?? i} cx={p.x} cy={p.y} r={3.5} fill={color} />
          ))}
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        {labels
          .filter((_, i) => i % every === 0)
          .map((label) => (
            <Text key={label} style={{ color: textColor, fontSize: 12 }}>
              {label}
            </Text>
          ))}
      </View>
    </View>
  );
}
