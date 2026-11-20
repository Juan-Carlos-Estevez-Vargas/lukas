import type { EChartsOption } from "echarts";
import { useMemo } from "react";
import { View } from "react-native";
import { type LineChartProps, toUnits } from "./types";
import { useEChart } from "./use-echart.web";

/** Línea con ECharts (SVG) en la web. */
export function LineChart(props: LineChartProps) {
  const { labels, values, color, height, description, formatValue, gridColor, textColor } = props;
  const option = useMemo<EChartsOption>(
    () => ({
      animation: false,
      grid: { left: 8, right: 8, top: 8, bottom: 24, containLabel: false },
      tooltip: {
        trigger: "axis",
        formatter: (p) => {
          const item = Array.isArray(p) ? p[0] : p;
          return `${item?.name ?? ""}: ${formatValue(values[item?.dataIndex ?? 0] ?? 0n)}`;
        },
      },
      xAxis: {
        type: "category",
        data: [...labels],
        boundaryGap: false,
        axisLine: { lineStyle: { color: gridColor } },
        axisTick: { show: false },
        axisLabel: { color: textColor },
      },
      yAxis: {
        type: "value",
        axisLabel: { show: false },
        splitLine: { lineStyle: { color: gridColor } },
      },
      series: [
        {
          type: "line",
          data: values.map(toUnits),
          itemStyle: { color },
          lineStyle: { color, width: 2.5 },
          symbolSize: 7,
        },
      ],
    }),
    [labels, values, color, formatValue, gridColor, textColor],
  );
  const ref = useEChart(option);
  return (
    <View
      ref={ref}
      style={{ height: height + 24, width: "100%" }}
      accessibilityRole="image"
      accessibilityLabel={description}
    />
  );
}
