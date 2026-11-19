import { createApp } from "./app";
import type { Env } from "./env";
import { log } from "./http/request-context";
import { defaultRatesFactory } from "./modules/rates/factory";
import { refreshTrm } from "./modules/rates/trm";

const app = createApp();

export default {
  fetch: app.fetch,
  /** Cron diario (wrangler.jsonc): guarda la TRM del día desde datos abiertos. */
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const { source, store } = defaultRatesFactory(env);
    ctx.waitUntil(
      refreshTrm(source, store, new Date()).then(
        (rate) => log("info", "trm_refreshed", { day: rate?.day ?? null, found: rate !== null }),
        (error: unknown) =>
          log("error", "trm_refresh_failed", {
            message: error instanceof Error ? error.message : String(error),
          }),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
