const channel = (value: number): number => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** Luminancia relativa de un color `#RRGGBB` (WCAG 2.x). */
export const luminance = (hex: string): number => {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`Color inválido: ${hex}`);
  const at = (start: number) => channel(Number.parseInt(hex.slice(start, start + 2), 16));
  return 0.2126 * at(1) + 0.7152 * at(3) + 0.0722 * at(5);
};

/** Razón de contraste entre dos colores, de 1 a 21. */
export const contrastRatio = (a: string, b: string): number => {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
