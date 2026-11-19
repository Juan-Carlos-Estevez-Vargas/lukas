import { describe, expect, it } from "vitest";
import { createConnection } from "./connection";
import { migrate } from "./migrations";
import { nodeSqlite } from "./node-sqlite.test-helper";
import { sqlitePreferences } from "./preferences";
import { LOCAL_MIGRATIONS } from "./schema";

describe("preferencias", () => {
  it("guarda, reemplaza y borra valores", async () => {
    const db = createConnection(nodeSqlite());
    await migrate(db, LOCAL_MIGRATIONS);
    const prefs = sqlitePreferences(db);
    expect(await prefs.get("display.discreet")).toBeNull();
    await prefs.set("display.discreet", "1");
    await prefs.set("display.discreet", "0");
    expect(await prefs.get("display.discreet")).toBe("0");
    await prefs.remove("display.discreet");
    expect(await prefs.get("display.discreet")).toBeNull();
  });
});
