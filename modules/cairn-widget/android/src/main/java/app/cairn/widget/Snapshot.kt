package app.cairn.widget

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/**
 * The snapshot the app drops off, and what the widget reads from it.
 *
 * One preferences file for everything: the notes, the tags, and the filter
 * chosen on each placed widget. There can be several widgets, each with its own
 * filter, but they share a single list — copying it per widget would grow the
 * file without adding anything.
 */
object Snapshot {

  private const val PREFS = "cairn.widget"
  private const val KEY_DATA = "snapshot"

  /** Tag filter, one per placed widget. Empty means "all tags". */
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

  /** Forgets the filter of a widget removed from the home screen. */
  fun forget(context: Context, widgetId: Int) {
    prefs(context).edit().remove(filterKey(widgetId)).apply()
  }

  // ------------------------------------------------------------- reading

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
   * Reads the snapshot.
   *
   * Any read can fail: the app has never run, the file is from an earlier
   * version, the JSON is truncated. The widget then renders an empty list and
   * its welcome message, which is infinitely preferable to a crash on the
   * phone's home screen — a widget that closes on its own is indistinguishable
   * from a broken app.
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
