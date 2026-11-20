import { requireOptionalNativeModule } from "expo";

/** El módulo nativo `modules/device-security` (solo Android). */
export interface DeviceSecurityModule {
  /** Enciende o apaga FLAG_SECURE en la ventana; `false` si aún no hay actividad. */
  setSecure(on: boolean): boolean;
  /** Señales de root encontradas (p. ej. `su-binary`, `test-keys`). */
  rootSignals(): string[];
}

/** `null` en la web, en iOS y en Expo Go. */
export const deviceSecurityModule: DeviceSecurityModule | null =
  requireOptionalNativeModule<DeviceSecurityModule>("LukasDeviceSecurity");
