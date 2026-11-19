import { describe, expect, it } from "vitest";
import { Money } from "../money";
import {
  type Account,
  archiveAccount,
  createAccount,
  unarchiveAccount,
  updateAccount,
} from "./account";

const t0 = new Date("2026-11-01T00:00:00Z");
const t1 = new Date("2026-11-19T00:00:00Z");
const cop = (n: bigint) => Money.ofMinor(n, "COP");

const visa = (): Account => {
  const res = createAccount(
    { name: "Visa", type: "credit_card", currency: "COP", last4: "1234", closingDay: 15 },
    "v",
    t0,
  );
  if (!res.ok) throw res.error;
  return res.value;
};

describe("updateAccount", () => {
  it("cambia lo pedido, conserva lo demás y sube la versión", () => {
    const res = updateAccount(visa(), { name: "Visa Oro", dueDay: 30 }, t1);
    expect(res.ok && res.value).toMatchObject({
      name: "Visa Oro",
      last4: "1234",
      closingDay: 15,
      dueDay: 30,
      createdAt: t0,
      updatedAt: t1,
      version: 2,
    });
  });

  it("permite borrar campos opcionales", () => {
    const res = updateAccount(visa(), { last4: null }, t1);
    expect(res.ok && res.value.last4).toBeNull();
  });

  it("valida igual que al crear", () => {
    const res = updateAccount(visa(), { name: "  " }, t1);
    expect(!res.ok && res.error.code).toBe("account_name_required");
  });
});

describe("archivar", () => {
  it("archiva una cuenta en cero y la puede restaurar", () => {
    const res = archiveAccount(visa(), cop(0n), t1);
    expect(res.ok && res.value.archivedAt).toEqual(t1);
    if (!res.ok) return;
    expect(archiveAccount(res.value, cop(0n), t1)).toEqual({ ok: true, value: res.value });
    const back = unarchiveAccount(res.value, t1);
    expect(back.archivedAt).toBeNull();
    expect(back.version).toBe(3);
    expect(unarchiveAccount(back, t1)).toBe(back);
  });

  it("no archiva una cuenta con saldo", () => {
    const res = archiveAccount(visa(), cop(-100n), t1);
    expect(!res.ok && res.error.code).toBe("balance_not_zero");
  });
});
