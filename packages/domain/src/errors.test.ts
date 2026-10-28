import { describe, expect, it } from "vitest";
import { DomainError } from "./errors";

describe("DomainError", () => {
  it("conserva el código y el mensaje", () => {
    const error = new DomainError("currency_mismatch", "Monedas distintas");
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("currency_mismatch");
    expect(error.message).toBe("Monedas distintas");
    expect(error.name).toBe("DomainError");
  });
});
