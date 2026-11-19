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
        "src/reminders/**/*.ts",
        "src/movements/**/*.ts",
        "src/receipts/**/*.ts",
        "src/recurring/**/*.ts",
        "src/budgets/**/*.ts",
        "src/goals/**/*.ts",
        "src/home/**/*.ts",
        "src/rates/**/*.ts",
        "src/backup/**/*.ts",
        "app.config.ts",
      ],
      // database*.ts, lock-store*.ts, notifications*.ts y receipt-store*.ts envuelven módulos nativos; su lógica vive
      // en open.ts, pin.ts, policy.ts y card-reminders.ts, que sí tienen pruebas.
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.test-helper.ts",
        "src/data/database*.ts",
        "src/lock/lock-store*.ts",
        "src/reminders/notifications*.ts",
        "src/receipts/receipt-store*.ts",
        "src/receipts/pick*.ts",
      ],
      reporter: ["text", "json-summary"],
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
});
