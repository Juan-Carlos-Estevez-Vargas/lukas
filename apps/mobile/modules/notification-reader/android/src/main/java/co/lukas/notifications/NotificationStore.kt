package co.lukas.notifications

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Cola local de avisos leídos y lista de apps permitidas. Vive en las preferencias privadas de la
 * app (sin copia de seguridad) y la app la vacía cada vez que la lee: nada sale del teléfono.
 */
class NotificationStore(context: Context) {
  private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun allowed(): Set<String> = prefs.getStringSet(ALLOWED, emptySet()) ?: emptySet()

  fun setAllowed(apps: List<String>) {
    prefs.edit().putStringSet(ALLOWED, apps.toSet()).apply()
    if (apps.isEmpty()) clear()
  }

  @Synchronized
  fun push(item: JSONObject) {
    val queue = read()
    val id = item.optString("id")
    for (i in 0 until queue.length()) {
      // El mismo aviso actualizado (misma clave y mismo texto) no se encola dos veces.
      if (queue.optJSONObject(i)?.optString("id") == id) return
    }
    queue.put(item)
    val trimmed = JSONArray()
    val from = maxOf(0, queue.length() - MAX_QUEUE)
    for (i in from until queue.length()) trimmed.put(queue.get(i))
    prefs.edit().putString(QUEUE, trimmed.toString()).apply()
  }

  @Synchronized
  fun drain(): List<Map<String, Any>> {
    val queue = read()
    prefs.edit().remove(QUEUE).apply()
    val out = ArrayList<Map<String, Any>>(queue.length())
    for (i in 0 until queue.length()) {
      val o = queue.optJSONObject(i) ?: continue
      out.add(
        mapOf(
          "id" to o.optString("id"),
          "app" to o.optString("app"),
          "title" to o.optString("title"),
          "text" to o.optString("text"),
          "postedAt" to o.optLong("postedAt").toDouble(),
        ),
      )
    }
    return out
  }

  @Synchronized
  fun clear() {
    prefs.edit().remove(QUEUE).apply()
  }

  private fun read(): JSONArray =
    try {
      JSONArray(prefs.getString(QUEUE, "[]") ?: "[]")
    } catch (e: Exception) {
      JSONArray()
    }

  companion object {
    private const val PREFS = "co.lukas.notifications"
    private const val ALLOWED = "allowed"
    private const val QUEUE = "queue"
    private const val MAX_QUEUE = 200
  }
}
