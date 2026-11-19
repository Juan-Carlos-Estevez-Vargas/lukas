/** Escalas compartidas por ambos temas. Valores en puntos lógicos (React Native) o px (web). */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;
export const fontSize = { caption: 12, body: 15, title: 20, display: 32 } as const;
export const fontWeight = { regular: "400", medium: "500", bold: "700" } as const;

export interface ColorTokens {
  readonly background: string;
  readonly surface: string;
  readonly border: string;
  readonly text: string;
  readonly textMuted: string;
  readonly primary: string;
  readonly onPrimary: string;
  /** Ingresos y saldos a favor. */
  readonly income: string;
  /** Gastos y saldos en contra. */
  readonly expense: string;
  readonly warning: string;
}

export const light: ColorTokens = {
  background: "#F7F8FA",
  surface: "#FFFFFF",
  border: "#DADDE3",
  text: "#14171F",
  textMuted: "#565D6B",
  primary: "#0B6E4F",
  onPrimary: "#FFFFFF",
  income: "#0B6E4F",
  expense: "#B42318",
  warning: "#8A5A00",
};

export const dark: ColorTokens = {
  background: "#0E1116",
  surface: "#171B22",
  border: "#2A303B",
  text: "#EEF0F4",
  textMuted: "#A3AAB8",
  primary: "#3DD6A3",
  onPrimary: "#04140E",
  income: "#3DD6A3",
  expense: "#FF8A80",
  warning: "#F5C451",
};

export type ColorScheme = "light" | "dark";

export interface Theme {
  readonly scheme: ColorScheme;
  readonly colors: ColorTokens;
  readonly space: typeof space;
  readonly radius: typeof radius;
  readonly fontSize: typeof fontSize;
  readonly fontWeight: typeof fontWeight;
}

/** Tema según la preferencia del sistema; sin preferencia se usa el claro. */
export const themeFor = (scheme: ColorScheme | null | undefined): Theme => ({
  scheme: scheme === "dark" ? "dark" : "light",
  colors: scheme === "dark" ? dark : light,
  space,
  radius,
  fontSize,
  fontWeight,
});
