import { hitBar, layoutBars } from "@lukas/charts";
import { Canvas, Line, Rect, vec } from "@shopify/react-native-skia";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { BarChartProps } from "./types";

/** Barras agrupadas dibujadas con Skia. Las etiquetas son texto nativo (accesible y nítido). */
export function BarChart(props: BarChartProps) {
  const { labels, series, height, description, onSelect, gridColor, textColor, testID } = props;
  const [width, setWidth] = useState(0);
  const layout = useMemo(() => layoutBars(series, { width, height }), [series, width, height]);

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="image"
      accessibilityLabel={description}
    >
      <Pressable
        testID={testID}
        onPress={(e) => {
          const hit = hitBar(layout, e.nativeEvent.locationX);
          if (hit) onSelect?.(hit.group, hit.series);
        }}
      >
        {width > 0 ? (
          <Canvas style={{ width, height }}>
            {layout.ticks.map((tick) => {
              const y =
                height -
                (layout.max > 0n ? Number((tick * 1000n) / layout.max) / 1000 : 0) * height;
              return (
                <Line
                  key={String(tick)}
                  p1={vec(0, y)}
                  p2={vec(width, y)}
                  color={gridColor}
                  strokeWidth={1}
                />
              );
            })}
            {layout.bars.map((bar) => (
              <Rect
                key={`${bar.group}-${bar.series}`}
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                color={series[bar.series]?.color ?? textColor}
              />
            ))}
          </Canvas>
        ) : (
          <View style={{ height }} />
        )}
      </Pressable>
      <View style={{ flexDirection: "row" }}>
        {labels.map((label, i) => (
          <Pressable
            key={label}
            testID={testID ? `${testID}-${i}` : undefined}
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={() => onSelect?.(i, null)}
            style={{ width: layout.groupWidth, minHeight: 32, justifyContent: "center" }}
          >
            <Text style={{ color: textColor, fontSize: 12, textAlign: "center" }}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
