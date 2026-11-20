import { LEGAL_VERSIONS } from "@lukas/domain";
import { describe, expect, it } from "vitest";
import { cardFixture } from "../accounts/card.test-helper";
import {
  acceptedHere,
  acceptNow,
  createConsentClient,
  rememberAcceptance,
  resolveConsent,
} from "./consent";
import { LEGAL_TEXTS } from "./documents";

const API = "https://api.lukas.test";

/** API falsa: guarda si ya se aceptó. */
function fakeApi(options: { offline?: boolean; failAccept?: boolean } = {}) {
  let accepted = false;
  const posts: unknown[] = [];
  const client = createConsentClient(API, async (url, init) => {
    expect(url).toBe(`${API}/v1/legal/consents`);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer tok");
    if (options.offline) throw new Error("sin red");
    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)));
      if (options.failAccept) return new Response(null, { status: 503 });
      accepted = true;
    }
    return Response.json({
      current: LEGAL_VERSIONS,
      pending: accepted ? [] : ["privacy", "terms", "cookies"],
    });
  });
  return { client, posts, isAccepted: () => accepted };
}

describe("autorización de datos en la app", () => {
  it("si se aceptó al registrarse en este teléfono, se envía sola", async () => {
    const { db } = await cardFixture({ closingDay: null, dueDay: null });
    const api = fakeApi();
    await rememberAcceptance(db);
    expect(await resolveConsent(db, api.client, "tok")).toBe("ok");
    expect(api.posts).toEqual([LEGAL_VERSIONS]);
    expect(await resolveConsent(db, api.client, "tok")).toBe("ok");
    expect(api.posts).toHaveLength(1);
  });

  it("si no se aceptó aquí, se pregunta; al aceptar queda registrada", async () => {
    const { db } = await cardFixture({ closingDay: null, dueDay: null });
    const api = fakeApi();
    expect(await acceptedHere(db)).toBe(false);
    expect(await resolveConsent(db, api.client, "tok")).toBe("ask");
    expect(await acceptNow(db, api.client, "tok")).toBe(true);
    expect(await acceptedHere(db)).toBe(true);
    expect(api.isAccepted()).toBe(true);
  });

  it("sin red no bloquea la app", async () => {
    const { db } = await cardFixture({ closingDay: null, dueDay: null });
    expect(await resolveConsent(db, fakeApi({ offline: true }).client, "tok")).toBe("offline");
    await rememberAcceptance(db);
    expect(await resolveConsent(db, fakeApi({ failAccept: true }).client, "tok")).toBe("offline");
    expect(await acceptNow(db, fakeApi({ offline: true }).client, "tok")).toBe(false);
  });

  it("una respuesta rara cuenta como sin red", async () => {
    const client = createConsentClient(API, async () => Response.json({ pending: "todo" }));
    expect(await client.pending("tok")).toBeNull();
    const broken = createConsentClient(API, async () => new Response("no json"));
    expect(await broken.pending("tok")).toBeNull();
  });

  it("los textos tienen la versión vigente y contenido en cada sección", () => {
    for (const text of Object.values(LEGAL_TEXTS)) {
      expect(text.version).toBe(LEGAL_VERSIONS[text.document]);
      expect(text.sections.length).toBeGreaterThan(3);
      for (const s of text.sections) expect(s.paragraphs.length).toBeGreaterThan(0);
    }
    const privacy = LEGAL_TEXTS.privacy.sections.map((s) => s.paragraphs.join(" ")).join(" ");
    expect(privacy).toMatch(/Superintendencia de Industria y Comercio/);
    expect(privacy).toMatch(/10 días hábiles/);
    expect(privacy).toMatch(/15 días hábiles/);
    expect(privacy).toMatch(/artículo 26 de la Ley 1581/);
  });
});
