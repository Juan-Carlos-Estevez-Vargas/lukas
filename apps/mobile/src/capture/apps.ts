/**
 * Apps de bancos y billeteras cuyas notificaciones Lukas sabe leer. La persona elige cuáles; las
 * demás el lector del teléfono las descarta sin mirarlas.
 */
export interface CaptureApp {
  readonly app: string;
  readonly name: string;
}

export const CAPTURE_APPS: readonly CaptureApp[] = [
  { app: "com.nequi.MobileApp", name: "Nequi" },
  { app: "com.davivienda.daviplataapp", name: "Daviplata" },
  { app: "com.todo1.mobile", name: "Bancolombia" },
  { app: "com.davivienda.daviviendaapp", name: "Davivienda" },
  { app: "co.com.bbva.mb", name: "BBVA" },
  { app: "com.nu.production", name: "Nu" },
];

export const isCaptureApp = (app: string): boolean => CAPTURE_APPS.some((a) => a.app === app);
