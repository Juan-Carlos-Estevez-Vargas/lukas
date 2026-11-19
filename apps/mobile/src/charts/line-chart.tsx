import { layoutLine, linePath } from "@lukas/charts";
import { Canvas, Circle, Line, Path, vec } from "@shopify/react-native-skia";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import type { LineChartProps } from "./types";

/** Línea con Skia; el cero se marca para ver cuándo el patrimonio fue negativo. */
export function LineChart(props: LineChartProps) {
  const { labels, values, color, height, description, gridColor, textColor } = props;
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
        <Canvas style={{ width, height }}>
          <Line
            p1={vec(0, layout.zeroY + pad)}
            p2={vec(width, layout.zeroY + pad)}
            color={gridColor}
            strokeWidth={1}
          />
          <Path path={linePath(points)} color={color} style="stroke" strokeWidth={2.5} />
          {points.map((p, i) => (
            <Circle key={labels[i] ?? i} cx={p.x} cy={p.y} r={3.5} color={color} />
          ))}
        </Canvas>
      ) : (
        <View style={{ height }} />
      )}
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        {labels.map((label) => (
          <Text key={label} style={{ color: textColor, fontSize: 12 }}>
            {label}
          </Text>
        ))}
      </View>
    </View>
  );
}
