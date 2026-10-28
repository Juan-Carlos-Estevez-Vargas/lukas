import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // El esquema es declarativo; su comportamiento se prueba en ledger.test.ts contra Postgres.
      exclude: ["src/**/*.test.ts", "src/test/**", "src/index.ts", "src/schema/**"],
      reporter: ["text", "json-summary"],
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
});
