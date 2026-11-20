package co.lukas.security

import android.os.Build
import android.view.WindowManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * Protecciones del teléfono (FIN-405, MASVS-RESILIENCE y MASVS-PLATFORM):
 * - FLAG_SECURE: Android no deja tomar capturas ni grabar la pantalla de Lukas y la oculta en
 *   la vista de apps recientes.
 * - Señales de root: no bloquean la app (sería fácil de saltar y castiga a quien tiene un ROM
 *   personalizado), solo le avisan a la persona que sus datos quedan más expuestos.
 */
class DeviceSecurityModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LukasDeviceSecurity")

    Function("setSecure") { on: Boolean ->
      val activity = appContext.currentActivity ?: return@Function false
      activity.runOnUiThread {
        if (on) {
          activity.window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE,
          )
        } else {
          activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
      }
      true
    }

    // Nombres de las señales encontradas; la lógica de qué hacer con ellas vive en TypeScript.
    Function("rootSignals") {
      val signals = mutableListOf<String>()
      if (Build.TAGS?.contains("test-keys") == true) signals.add("test-keys")
      if (SU_PATHS.any { File(it).exists() }) signals.add("su-binary")
      if (ROOT_APPS.any { File(it).exists() }) signals.add("root-app")
      if (pathHasSu()) signals.add("su-in-path")
      signals
    }
  }

  private fun pathHasSu(): Boolean =
    System.getenv("PATH")
      .orEmpty()
      .split(':')
      .filter { it.isNotBlank() }
      .any { File(it, "su").exists() }

  companion object {
    private val SU_PATHS =
      listOf(
        "/system/bin/su",
        "/system/xbin/su",
        "/sbin/su",
        "/system/sd/xbin/su",
        "/system/bin/failsafe/su",
        "/data/local/su",
        "/data/local/bin/su",
        "/data/local/xbin/su",
        "/su/bin/su",
      )
    private val ROOT_APPS =
      listOf(
        "/system/app/Superuser.apk",
        "/system/app/SuperSU.apk",
        "/data/adb/magisk",
        "/sbin/.magisk",
        "/cache/.disable_magisk",
      )
  }
}
