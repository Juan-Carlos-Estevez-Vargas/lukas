import { createApp } from "./app";
import type { Env } from "./env";
import { log } from "./http/request-context";
import { WEEKLY_CRON, weeklyCron } from "./modules/notifications/factory";
import { defaultRatesFactory } from "./modules/rates/factory";
import { refreshTrm } from "./modules/rates/trm";

const app = createApp();

export default {
  fetch: app.fetch,
  /**
   * Crons (wrangler.jsonc): el diario guarda la TRM del día desde datos abiertos; el del domingo
   * manda el resumen de la semana.
   */
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (controller.cron === WEEKLY_CRON) {
      ctx.waitUntil(
        weeklyCron(env, new Date()).then(
          (r) => log("info", "weekly_summary_sent", r),
          (error: unknown) =>
            log("error", "weekly_summary_failed", {
              message: error instanceof Error ? error.message : String(error),
            }),
        ),
      );
      return;
    }
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
