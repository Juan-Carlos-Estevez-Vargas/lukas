#!/usr/bin/env bash
# Corre dentro del emulador de e2e.yml: instala el APK, pasa los flujos de Maestro y mide el
# presupuesto de rendimiento. Uso: bash apps/mobile/e2e/run.sh <APK> <carpeta de resultados>
set -uo pipefail

apk=$1
out=$2
mkdir -p "$out"

booted() { [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = "1" ]; }

# La app sigue el idioma del teléfono y los flujos están en español. Se cambia aquí y no con
# `-change-locale` del emulador: ese reinicia el framework mientras la acción aún le manda comandos.
if [ "$(adb shell getprop persist.sys.locale | tr -d '\r')" != "es-CO" ]; then
  adb root && adb wait-for-device
  adb shell "setprop persist.sys.locale es-CO; setprop ctl.restart zygote"
  sleep 15
  adb wait-for-device
  until booted; do sleep 2; done
fi
echo "Idioma del emulador: $(adb shell getprop persist.sys.locale | tr -d '\r')"

# Tras reiniciar el framework (cambio de idioma) `sys.boot_completed` puede decir 1 antes de que el
# gestor de paquetes vuelva: sin esto, `adb install` falla con "Can't find service: package".
for _ in $(seq 1 60); do
  adb shell pm path android >/dev/null 2>&1 && break
  sleep 2
done

# El servicio de paquetes a veces corta la conexión ("Broken pipe") justo después de arrancar.
installed=1
for _ in 1 2 3; do
  adb install -r "$apk" && { installed=0; break; }
  sleep 10
done
[ "$installed" -eq 0 ] || exit 1

maestro test apps/mobile/.maestro \
  --format junit --output "$out/maestro.xml" --debug-output "$out/maestro"
flows=$?

# Al final, con la sesión abierta y datos: el arranque mide la app como la usa la gente.
node apps/mobile/e2e/measure.ts "$apk"
perf=$?

[ "$flows" -eq 0 ] && [ "$perf" -eq 0 ]
