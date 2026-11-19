import { Hono } from "hono";
import type { AppContext } from "../../env";

/**
 * security.txt (RFC 9116). `Expires` es obligatorio y no puede pasar de un año: renovarlo
 * cada noviembre junto con la revisión del modelo de amenazas.
 */
export const SECURITY_TXT = [
  "Contact: https://github.com/Juan-Carlos-Estevez-Vargas/lukas/security/advisories/new",
  "Expires: 2027-11-01T00:00:00.000Z",
  "Preferred-Languages: es, en",
  "Policy: https://github.com/Juan-Carlos-Estevez-Vargas/lukas/blob/main/SECURITY.md",
  "",
].join("\n");

export const securityTxtRoutes = new Hono<AppContext>().get("/.well-known/security.txt", (c) =>
  c.text(SECURITY_TXT, 200, { "Cache-Control": "public, max-age=86400" }),
);
