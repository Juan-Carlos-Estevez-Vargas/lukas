import { defineConfig } from "vitest/config";

// Solo la lógica pura (i18n, cliente de la API, base local) se prueba con Vitest; las pantallas se prueban
// en el dispositivo y, más adelante, con pruebas de extremo a extremo.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "*.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "src/i18n/**/*.ts",
        "src/api/**/*.ts",
        "src/data/**/*.ts",
        "src/format/**/*.ts",
        "src/lock/**/*.ts",
        "src/onboarding/**/*.ts",
        "src/accounts/**/*.ts",
        "app.config.ts",
      ],
      // database*.ts y lock-store*.ts envuelven módulos nativos; su lógica vive en open.ts, pin.ts y
      // policy.ts, que sí tienen pruebas.
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.test-helper.ts",
        "src/data/database*.ts",
        "src/lock/lock-store*.ts",
      ],
      reporter: ["text", "json-summary"],
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
});
