package app.cairn.widget

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/**
 * L'instantané que l'application dépose, et ce que le widget en lit.
 *
 * Un seul fichier de préférences pour tout : les notes, les tags, et le filtre
 * choisi sur chaque widget posé. Les widgets sont plusieurs, chacun avec son
 * filtre, mais ils partagent la même liste — la recopier par widget ferait
 * grossir le fichier sans rien apporter.
 */
object Snapshot {

  private const val PREFS = "cairn.widget"
  private const val KEY_DATA = "snapshot"

  /** Filtre par tag, un par widget posé. Vide veut dire « tous les tags ». */
  private fun filterKey(widgetId: Int) = "filter.$widgetId"

  fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun write(context: Context, json: String) {
    prefs(context).edit().putString(KEY_DATA, json).apply()
  }

  fun tagFilter(context: Context, widgetId: Int): String =
    prefs(context).getString(filterKey(widgetId), "") ?: ""

  fun setTagFilter(context: Context, widgetId: Int, tagId: String) {
    prefs(context).edit().putString(filterKey(widgetId), tagId).apply()
  }

  /** Oublie le filtre d'un widget retiré de l'écran d'accueil. */
  fun forget(context: Context, widgetId: Int) {
    prefs(context).edit().remove(filterKey(widgetId)).apply()
  }

  // ------------------------------------------------------------- lecture

  data class Note(
    val id: String,
    val title: String,
    val preview: String,
    val color: String,
    val checklist: Boolean,
    val pinned: Boolean,
    val tagIds: List<String>,
  )

  data class Tag(val id: String, val name: String, val color: String)

  data class Data(val notes: List<Note>, val tags: List<Tag>)

  /**
   * Lit l'instantané.
   *
   * Toute lecture peut échouer : l'application n'a jamais tourné, le fichier est
   * d'une version antérieure, le JSON est tronqué. Le widget rend alors une
   * liste vide et son message d'accueil, ce qui est infiniment préférable à un
   * plantage sur l'écran d'accueil du téléphone — un widget qui se ferme tout
   * seul est indiscernable d'une application cassée.
   */
  fun read(context: Context): Data {
    val raw = prefs(context).getString(KEY_DATA, null) ?: return Data(emptyList(), emptyList())
    return try {
      val root = JSONObject(raw)
      if (root.optInt("version") != 1) return Data(emptyList(), emptyList())
      Data(notes = readNotes(root.optJSONArray("notes")), tags = readTags(root.optJSONArray("tags")))
    } catch (_: Throwable) {
      Data(emptyList(), emptyList())
    }
  }

  private fun readNotes(array: JSONArray?): List<Note> {
    if (array == null) return emptyList()
    return (0 until array.length()).mapNotNull { index ->
      val item = array.optJSONObject(index) ?: return@mapNotNull null
      Note(
        id = item.optString("id"),
        title = item.optString("title"),
        preview = item.optString("preview"),
        color = item.optString("color"),
        checklist = item.optBoolean("checklist"),
        pinned = item.optBoolean("pinned"),
        tagIds = item.optJSONArray("tagIds").toStringList(),
      )
    }
  }

  private fun readTags(array: JSONArray?): List<Tag> {
    if (array == null) return emptyList()
    return (0 until array.length()).mapNotNull { index ->
      val item = array.optJSONObject(index) ?: return@mapNotNull null
      Tag(id = item.optString("id"), name = item.optString("name"), color = item.optString("color"))
    }
  }

  private fun JSONArray?.toStringList(): List<String> {
    if (this == null) return emptyList()
    return (0 until length()).map { optString(it) }
  }
}
