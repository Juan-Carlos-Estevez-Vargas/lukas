import type { EChartsOption, EChartsType } from "echarts";
import { useEffect, useRef } from "react";
import type { HostInstance } from "react-native";
import { echarts } from "./echarts.web";

/**
 * Monta ECharts sobre el `div` que react-native-web crea para un `View` y lo mantiene del tamaño
 * del contenedor. `onClick` recibe el índice del dato y de la serie tocados.
 */
export function useEChart(
  option: EChartsOption,
  onClick?: (dataIndex: number, seriesIndex: number) => void,
) {
  const ref = useRef<HostInstance>(null);
  const chart = useRef<EChartsType | null>(null);
  const click = useRef(onClick);
  click.current = onClick;

  useEffect(() => {
    const el = ref.current as unknown as HTMLElement | null;
    if (!el) return;
    const instance = echarts.init(el, undefined, { renderer: "svg" });
    chart.current = instance;
    instance.on("click", (p) => {
      if (typeof p.dataIndex === "number") click.current?.(p.dataIndex, p.seriesIndex ?? 0);
    });
    const resize = new ResizeObserver(() => instance.resize());
    resize.observe(el);
    return () => {
      resize.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);

  return ref;
}
