import type { EChartsOption } from "echarts";
import { useMemo } from "react";
import { View } from "react-native";
import { type BarChartProps, toUnits } from "./types";
import { useEChart } from "./use-echart.web";

/** Barras agrupadas con ECharts (SVG) en la web. */
export function BarChart(props: BarChartProps) {
  const {
    labels,
    series,
    height,
    description,
    formatValue,
    onSelect,
    gridColor,
    textColor,
    testID,
  } = props;
  const option = useMemo<EChartsOption>(
    () => ({
      animation: false,
      grid: { left: 8, right: 8, top: 8, bottom: 24, containLabel: false },
      tooltip: {
        trigger: "item",
        formatter: (p) => {
          const item = Array.isArray(p) ? p[0] : p;
          const s = series[item?.seriesIndex ?? 0];
          const v = s?.values[item?.dataIndex ?? 0] ?? 0n;
          return `${item?.name ?? ""} · ${s?.name ?? ""}: ${formatValue(v)}`;
        },
      },
      xAxis: {
        type: "category",
        data: [...labels],
        axisLine: { lineStyle: { color: gridColor } },
        axisTick: { show: false },
        axisLabel: { color: textColor },
      },
      yAxis: {
        type: "value",
        axisLabel: { show: false },
        splitLine: { lineStyle: { color: gridColor } },
      },
      series: series.map((s) => ({
        type: "bar",
        name: s.name,
        data: s.values.map(toUnits),
        itemStyle: { color: s.color },
        cursor: "pointer",
      })),
    }),
    [labels, series, formatValue, gridColor, textColor],
  );
  const ref = useEChart(option, (group, s) => onSelect?.(group, s));
  return (
    <View
      ref={ref}
      testID={testID}
      style={{ height: height + 24, width: "100%" }}
      accessibilityRole="image"
      accessibilityLabel={description}
    />
  );
}
