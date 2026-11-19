import { defineConfig } from "vitest/config";

// Solo la lógica pura (i18n, cliente de la API) se prueba con Vitest; las pantallas se prueban
// en el dispositivo y, más adelante, con pruebas de extremo a extremo.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/i18n/**/*.ts", "src/api/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      reporter: ["text", "json-summary"],
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
});
