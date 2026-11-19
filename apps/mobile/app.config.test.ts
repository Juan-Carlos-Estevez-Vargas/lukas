import { describe, expect, it } from "vitest";
import appConfig from "./app.config";
import pkg from "./package.json";

describe("app.config", () => {
  it("toma la versión de package.json y conserva app.json", () => {
    const config = appConfig({
      config: { name: "Lukas", slug: "lukas", scheme: "lukas" },
    } as Parameters<typeof appConfig>[0]);
    expect(config).toMatchObject({
      name: "Lukas",
      slug: "lukas",
      scheme: "lukas",
      version: pkg.version,
    });
  });

  it("usa valores por defecto si app.json no trae nombre", () => {
    const config = appConfig({ config: {} } as Parameters<typeof appConfig>[0]);
    expect(config).toMatchObject({ name: "Lukas", slug: "lukas" });
  });
});
