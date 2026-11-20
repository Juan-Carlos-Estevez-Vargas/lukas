import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type ConfigPlugin, withAndroidManifest, withDangerousMod } from "expo/config-plugins";

/**
 * Pinning de certificados para la API (FIN-405, MASVS-NETWORK). Se fija la llave pública (SPKI)
 * de las raíces que usa Cloudflare para `*.workers.dev` (Google Trust Services, Let's Encrypt,
 * SSL.com y la cadena de GlobalSign que firma a GTS). Si un proxy instala su propia CA en el
 * teléfono, la conexión con la API falla.
 *
 * Los pines vencen en `PIN_EXPIRATION`: después Android deja de aplicarlos (falla abierto) para
 * que una app vieja no quede sin conexión si Cloudflare cambia de CA. Hay que renovarlos antes,
 * recalculando con: openssl x509 -pubkey -noout | openssl pkey -pubin -outform der | sha256 | base64.
 */
export const PINNED_HOSTS = [
  "lukas-api.juank2001estevezvargas.workers.dev",
  "lukas-api-staging.juank2001estevezvargas.workers.dev",
] as const;

export const PIN_EXPIRATION = "2027-11-20";

export const PINS: readonly { readonly name: string; readonly sha256: string }[] = [
  { name: "GTS Root R1", sha256: "hxqRlPTu1bMS/0DITB1SSu0vd4u/8l8TjPgfaAp63Gc=" },
  { name: "GTS Root R3", sha256: "QXnt2YHvdHR3tJYmQIr0Paosp6t/nggsEGD4QJZ3Q0g=" },
  { name: "GTS Root R4", sha256: "mEflZT5enoR1FuXLgYYGqnVEoZvmf9c2bVBpiOjYQ0c=" },
  { name: "GlobalSign ECC Root CA R4", sha256: "CLOmM1/OXvSPjw5UOYbAf9GKOxImEp9hhku9W90fHMk=" },
  { name: "ISRG Root X1", sha256: "C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M=" },
  { name: "ISRG Root X2", sha256: "diGVwiVYbubAI3RW4hB9xU8e/CH2GnkuvVFZE8zmgzI=" },
  { name: "SSL.com TLS RSA Root CA 2022", sha256: "K89VOmb1cJAN3TK6bf4ezAbJGC1mLcG2Dh97dnwr3VQ=" },
  { name: "SSL.com TLS ECC Root CA 2022", sha256: "G/ANXI8TwJTdF+AFBM8IiIUPEv0Gf6H5LA/b9guG4yE=" },
  { name: "SSL.com Root CA RSA", sha256: "0cRTd+vc1hjNFlHcLgLCHXUeWqn80bNDH/bs9qMTSPo=" },
  { name: "SSL.com Root CA ECC", sha256: "oyD01TTXvpfBro3QSZc1vIlcMjrdLTiL/M9mLCPX+Zo=" },
];

/**
 * `network_security_config.xml`: sin tráfico en claro salvo hacia el Worker local del emulador
 * (`10.0.2.2`), CAs que instale el usuario no cuentan y la API va con pines. El cliente de
 * desarrollo (`devClient`) permite tráfico en claro para hablar con Metro en la red local.
 */
export function networkSecurityXml({ devClient = false }: { devClient?: boolean } = {}): string {
  const domains = PINNED_HOSTS.map((h) => `    <domain includeSubdomains="false">${h}</domain>`);
  const pins = PINS.map(
    (p) => `      <!-- ${p.name} -->\n      <pin digest="SHA-256">${p.sha256}</pin>`,
  );
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<network-security-config>",
    `  <base-config cleartextTrafficPermitted="${devClient}">`,
    "    <trust-anchors>",
    '      <certificates src="system" />',
    "    </trust-anchors>",
    "  </base-config>",
    '  <domain-config cleartextTrafficPermitted="true">',
    '    <domain includeSubdomains="false">10.0.2.2</domain>',
    '    <domain includeSubdomains="false">localhost</domain>',
    "  </domain-config>",
    "  <domain-config>",
    ...domains,
    `    <pin-set expiration="${PIN_EXPIRATION}">`,
    ...pins,
    "    </pin-set>",
    "  </domain-config>",
    "</network-security-config>",
    "",
  ].join("\n");
}

/** Escribe el XML en `res/xml` y lo enlaza desde `<application>` en el manifiesto. */
export const withNetworkSecurity: ConfigPlugin<{ devClient?: boolean } | undefined> = (
  config,
  { devClient = false } = {},
) => {
  const withFile = withDangerousMod(config, [
    "android",
    async (c) => {
      const dir = join(c.modRequest.platformProjectRoot, "app/src/main/res/xml");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "network_security_config.xml"), networkSecurityXml({ devClient }));
      return c;
    },
  ]);
  return withAndroidManifest(withFile, (c) => {
    const app = c.modResults.manifest.application?.[0];
    if (app) {
      app.$["android:networkSecurityConfig"] = "@xml/network_security_config";
      app.$["android:usesCleartextTraffic"] = devClient ? "true" : "false";
    }
    return c;
  });
};
