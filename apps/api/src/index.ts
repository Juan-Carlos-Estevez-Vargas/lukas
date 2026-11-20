import { createApp } from "./app";
import type { Env } from "./env";
import { log } from "./http/request-context";
import { isSummaryDay, weeklyCron } from "./modules/notifications/factory";
import { defaultRatesFactory } from "./modules/rates/factory";
import { refreshTrm } from "./modules/rates/trm";

const app = createApp();

export default {
  fetch: app.fetch,
  /**
   * Cron diario (wrangler.jsonc, 8:00 de Bogotá): guarda la TRM del día desde datos abiertos y, los
   * domingos, manda el resumen de la semana. Un solo cron: el plan gratis admite pocos por cuenta.
   */
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (isSummaryDay(new Date())) {
      ctx.waitUntil(
        weeklyCron(env, new Date()).then(
          (r) => log("info", "weekly_summary_sent", r),
          (error: unknown) =>
            log("error", "weekly_summary_failed", {
              message: error instanceof Error ? error.message : String(error),
            }),
        ),
      );
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
