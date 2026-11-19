/** Contrato común de los gráficos: Skia en el teléfono (`*.tsx`) y ECharts en la web (`*.web.tsx`). */

export interface ChartSeries {
  readonly key: string;
  /** Nombre visible (leyenda y lector de pantalla). */
  readonly name: string;
  readonly color: string;
  /** Un valor por etiqueta, en unidades menores. */
  readonly values: readonly bigint[];
}

export interface BarChartProps {
  readonly labels: readonly string[];
  readonly series: readonly ChartSeries[];
  readonly height: number;
  /** Texto para el lector de pantalla (el resumen de lo que muestra el gráfico). */
  readonly description: string;
  readonly formatValue: (minor: bigint) => string;
  /** `series` es `null` si el toque cayó en el grupo pero no sobre una barra. */
  readonly onSelect?: (group: number, series: number | null) => void;
  readonly gridColor: string;
  readonly textColor: string;
  /** Para las pruebas E2E: el área del gráfico es `testID` y cada etiqueta `testID-<i>`. */
  readonly testID?: string;
}

export interface LineChartProps {
  readonly labels: readonly string[];
  readonly values: readonly bigint[];
  readonly color: string;
  readonly height: number;
  readonly description: string;
  readonly formatValue: (minor: bigint) => string;
  readonly gridColor: string;
  readonly textColor: string;
}

/** Para ECharts: pesos con decimales solo para dibujar, nunca para sumar plata. */
export const toUnits = (minor: bigint): number => Number(minor) / 100;
