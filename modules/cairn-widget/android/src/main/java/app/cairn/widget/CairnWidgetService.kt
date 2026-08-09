package app.cairn.widget

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService

/**
 * Feeds the widget's list.
 *
 * The launcher binds to this service, asks it for one `RemoteViews` per row, and
 * displays them in its own process. None of this runs the app: that is why the
 * widget appears instantly, even after the phone has restarted.
 */
class CairnWidgetService : RemoteViewsService() {
  override fun onGetViewFactory(intent: Intent): RemoteViewsFactory {
    val widgetId = intent.getIntExtra(
      AppWidgetManager.EXTRA_APPWIDGET_ID,
      AppWidgetManager.INVALID_APPWIDGET_ID,
    )
    return CairnWidgetFactory(applicationContext, widgetId)
  }
}

private class CairnWidgetFactory(
  private val context: Context,
  private val widgetId: Int,
) : RemoteViewsService.RemoteViewsFactory {

  private var notes: List<Snapshot.Note> = emptyList()

  override fun onCreate() = Unit

  /**
   * Re-reads the snapshot and applies the filter.
   *
   * Called by the system on every `notifyAppWidgetViewDataChanged`, off the main
   * thread: this is the place meant for the reading work, and the only one where
   * doing any is allowed.
   */
  override fun onDataSetChanged() {
    val data = Snapshot.read(context)
    val filter = Snapshot.tagFilter(context, widgetId)
    notes = if (filter.isEmpty()) data.notes else data.notes.filter { filter in it.tagIds }
  }

  override fun onDestroy() {
    notes = emptyList()
  }

  override fun getCount() = notes.size

  override fun getViewAt(position: Int): RemoteViews {
    val note = notes.getOrNull(position) ?: return RemoteViews(context.packageName, R.layout.cairn_widget_item)
    val row = RemoteViews(context.packageName, R.layout.cairn_widget_item)

    // A note without a title does not show a blank row: it says what it is. The
    // same goes for a vault note with no code name, which must on no account
    // fall back to its title.
    val title = note.title.ifBlank {
      context.getString(
        if (note.checklist) R.string.cairn_widget_untitled_list else R.string.cairn_widget_untitled_note,
      )
    }
    row.setTextViewText(R.id.cairn_item_title, title)

    if (note.preview.isBlank()) {
      row.setViewVisibility(R.id.cairn_item_preview, View.GONE)
    } else {
      row.setViewVisibility(R.id.cairn_item_preview, View.VISIBLE)
      row.setTextViewText(R.id.cairn_item_preview, note.preview)
    }

    row.setViewVisibility(R.id.cairn_item_pin, if (note.pinned) View.VISIBLE else View.GONE)

    /**
     * The coloured vein, as on the grid's cards.
     *
     * A hairline down the left edge, not a tinted background: the tag palette is
     * calibrated for dots and borders, not for carrying text on top. The same
     * reasoning as in `NoteCard`, and the same reason not to depart from it here
     * — the widget has no theme of its own, it is painted on the launcher's
     * wallpaper.
     */
    val vein = tagColor(note.color)
    if (vein == null) {
      row.setViewVisibility(R.id.cairn_item_vein, View.INVISIBLE)
    } else {
      row.setViewVisibility(R.id.cairn_item_vein, View.VISIBLE)
      row.setInt(R.id.cairn_item_vein, "setBackgroundColor", vein)
    }

    // Fills in the template set by the provider: only the address changes from
    // one row to the next.
    row.setOnClickFillInIntent(
      R.id.cairn_item_root,
      Intent().setData(Uri.parse("cairn://note/${note.id}")),
    )

    return row
  }

  override fun getLoadingView(): RemoteViews? = null

  override fun getViewTypeCount() = 1

  /**
   * The note's identifier, not its position.
   *
   * With the position, the launcher believes row 3 is always the same note and
   * recycles its view as-is: after a reorder, the old note stayed on screen in
   * its place until the next scroll.
   */
  override fun getItemId(position: Int) =
    notes.getOrNull(position)?.id?.hashCode()?.toLong() ?: position.toLong()

  override fun hasStableIds() = true

  /**
   * The tag palette, hard-coded and owned as such.
   *
   * The values come from `tagPalette` in src/ui/theme.ts, dark variant. These
   * are the only colours in the project copied by hand outside the generator: a
   * `RemoteViews` cannot resolve a resource by a computed name, it needs an
   * integer. `npm run theme:check` covers the generated resources, not these —
   * hence this comment, and the rule: a shade changed in theme.ts is carried
   * over here.
   */
  private fun tagColor(key: String): Int? = when (key) {
    "ambre" -> Color.parseColor("#DFB369")
    "braise" -> Color.parseColor("#DB8452")
    "airelle" -> Color.parseColor("#D4737C")
    "bruyere" -> Color.parseColor("#A98BC4")
    "fjord" -> Color.parseColor("#6E9AC4")
    "aurore" -> Color.parseColor("#5DC6A4")
    "lichen" -> Color.parseColor("#A5BD72")
    "fer" -> Color.parseColor("#96A0A6")
    "bouleau" -> Color.parseColor("#D2CCBD")
    "granit" -> Color.parseColor("#8393A0")
    else -> null
  }
}
