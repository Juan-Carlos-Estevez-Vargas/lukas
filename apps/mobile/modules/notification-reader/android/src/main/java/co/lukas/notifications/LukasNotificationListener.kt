package co.lukas.notifications

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONObject

/**
 * Recibe cada notificación del teléfono. Descarta de entrada todo lo que no venga de una app que
 * la persona permitió; de las permitidas guarda solo título, texto y hora en la cola local.
 */
class LukasNotificationListener : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    val store = NotificationStore(applicationContext)
    if (sbn.packageName !in store.allowed()) return
    val notification = sbn.notification ?: return
    if (sbn.isOngoing || notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
    val extras = notification.extras ?: return
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
    val text =
      (extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
        ?: extras.getCharSequence(Notification.EXTRA_TEXT))
        ?.toString()
        .orEmpty()
    if (title.isBlank() && text.isBlank()) return
    val item =
      JSONObject()
        .put("id", "${sbn.key}|${(title + text).hashCode()}")
        .put("app", sbn.packageName)
        .put("title", title)
        .put("text", text)
        .put("postedAt", sbn.postTime)
    store.push(item)
    NotificationReaderModule.posted()
  }
}
