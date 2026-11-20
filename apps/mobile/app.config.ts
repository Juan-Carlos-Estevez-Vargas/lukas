import type { ConfigContext, ExpoConfig } from "expo/config";
import pkg from "./package.json";
import { withNetworkSecurity } from "./plugins/network-security.ts";

/**
 * La versión visible de la app sale de package.json, que sube Changesets en cada release
 * (docs/releases.md). El número de build (`versionCode` / `buildNumber`) lo incrementa EAS
 * de forma remota, así que no se fija aquí.
 */
export default ({ config }: ConfigContext): ExpoConfig =>
  withNetworkSecurity(
    {
      ...config,
      name: config.name ?? "Lukas",
      slug: config.slug ?? "lukas",
      version: pkg.version,
    },
    { devClient: process.env.LUKAS_DEV_CLIENT === "1" },
  );
