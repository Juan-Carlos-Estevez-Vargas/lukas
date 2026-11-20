package co.lukas.notifications

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

class NotificationReaderModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("LukasNotifications")

    Events(EVENT)

    OnCreate { current = WeakReference(this@NotificationReaderModule) }

    OnDestroy {
      if (current?.get() === this@NotificationReaderModule) current = null
    }

    // ¿La persona activó a Lukas en Ajustes > Acceso a notificaciones?
    Function("hasAccess") {
      val component = ComponentName(context, LukasNotificationListener::class.java)
      val enabled =
        Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")
          .orEmpty()
      enabled.split(':').any { ComponentName.unflattenFromString(it) == component }
    }

    Function("openSettings") {
      val intent =
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    Function("allowedApps") { NotificationStore(context).allowed().toList().sorted() }

    Function("setAllowedApps") { apps: List<String> -> NotificationStore(context).setAllowed(apps) }

    Function("drain") { NotificationStore(context).drain() }
  }

  companion object {
    private const val EVENT = "onNotification"

    @Volatile private var current: WeakReference<NotificationReaderModule>? = null

    /** Avisa a la app abierta que hay algo en la cola; si está cerrada, lo lee al volver. */
    fun posted() {
      current?.get()?.sendEvent(EVENT, mapOf<String, Any>())
    }
  }
}
