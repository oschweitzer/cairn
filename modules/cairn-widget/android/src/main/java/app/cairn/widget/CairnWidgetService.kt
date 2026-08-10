package app.cairn.widget

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
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

  /** Preview lines a row may take, and the matching room for a body note. */
  private var previewLines = MIN_PREVIEW_LINES
  private var previewChars = 0

  override fun onCreate() = Unit

  /**
   * Re-reads the snapshot, applies the filter, then shares out the height.
   *
   * Called by the system on every `notifyAppWidgetViewDataChanged`, off the main
   * thread: this is the place meant for the reading work, and the only one where
   * doing any is allowed.
   */
  override fun onDataSetChanged() {
    val data = Snapshot.read(context)
    val filter = Snapshot.tagFilter(context, widgetId)
    notes = if (filter.isEmpty()) data.notes else data.notes.filter { filter in it.tagIds }
    shareOutHeight()
  }

  /**
   * How many preview lines each row may take.
   *
   * A `RemoteViews` cannot measure anything: it is built here and drawn in the
   * launcher's process, and nothing comes back. So a row used to be given two
   * lines whatever happened, and filtering down to a single list left most of
   * the widget empty below it.
   *
   * Two figures are known, though, and they are enough: the widget's own size,
   * which the launcher keeps in its options, and how many notes survive the
   * filter. The height left under the header, divided between the rows, says
   * what each may spend — floored at the two lines that were always there, and
   * capped at what the row layout allows.
   *
   * The width serves the free-text notes. A checklist preview is already cut
   * into lines and can be counted exactly; a paragraph's line count depends on
   * where it wraps, which only the launcher will know. So it is estimated from
   * the width, and an estimate is all it is: too low and the note simply says a
   * little less than it could, too high and its row grows past its share and the
   * list scrolls. Neither is worth a more elaborate mechanism.
   */
  private fun shareOutHeight() {
    val options = if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
      null
    } else {
      AppWidgetManager.getInstance(context).getAppWidgetOptions(widgetId)
    }

    /**
     * In portrait a widget is at its narrowest and its tallest, in landscape the
     * reverse. The options carry the bounds of both at once, so which end of
     * each pair describes the screen in front of us depends on the orientation.
     */
    val landscape =
      context.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
    val heightKey = if (landscape) {
      AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT
    } else {
      AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT
    }
    val widthKey = if (landscape) {
      AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH
    } else {
      AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH
    }

    // Zero until the launcher has sized the widget once. The declared minimum is
    // the honest guess in the meantime, and the first resize corrects it.
    val heightDp = options?.getInt(heightKey)?.takeIf { it > 0 } ?: FALLBACK_HEIGHT_DP
    val widthDp = options?.getInt(widthKey)?.takeIf { it > 0 } ?: FALLBACK_WIDTH_DP

    // The dividers are drawn between the rows, so there is one fewer of them
    // than there are notes, and the height they take is not the rows' to spend.
    val dividersDp = DIVIDER_DP * (notes.size - 1).coerceAtLeast(0)
    val listDp = (heightDp - HEADER_DP - dividersDp).coerceAtLeast(0)
    val perRowDp = listDp / notes.size.coerceAtLeast(1)

    previewLines = ((perRowDp - ROW_CHROME_DP) / PREVIEW_LINE_DP)
      .coerceIn(MIN_PREVIEW_LINES, MAX_PREVIEW_LINES)
    previewChars =
      ((widthDp - ROW_TEXT_INSET_DP).coerceAtLeast(0) / CHAR_DP * previewLines).toInt()
  }

  /**
   * Cuts a preview down to the room its row has.
   *
   * A checklist is cut on its own line breaks, so a row never shows half an
   * item. Anything else is cut on length, with the imprecision owned above.
   */
  private fun clipPreview(note: Snapshot.Note): String {
    val text = note.preview

    if (note.checklist || text.contains('\n')) {
      val lines = text.split('\n')
      if (lines.size <= previewLines) return text
      return ellipsis(lines.take(previewLines).joinToString("\n"))
    }

    if (previewChars <= 0 || text.length <= previewChars) return text
    return ellipsis(text.take(previewChars))
  }

  // The app already ends a preview it had to cut with an ellipsis; a second one
  // would read as punctuation rather than as an omission.
  private fun ellipsis(text: String): String {
    val trimmed = text.trimEnd()
    return if (trimmed.endsWith('…')) trimmed else "$trimmed…"
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
      row.setTextViewText(R.id.cairn_item_preview, clipPreview(note))
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
  /**
   * The widget's geometry, in points, read off the layouts rather than guessed.
   *
   * These mirror res/layout/cairn_widget.xml and cairn_widget_item.xml. A
   * padding changed there and not here costs a line of preview, no more: the
   * figures decide how the height is shared out, never what is drawn.
   */
  private companion object {
    /** Header: a 40dp row with 8dp above and below, then the hairline. */
    const val HEADER_DP = 57

    /** A row, minus its preview: 10dp of padding twice, the title, the 2dp gap. */
    const val ROW_CHROME_DP = 42

    /** `android:dividerHeight` on the list: the seam plus its air, drawable/cairn_widget_divider.xml. */
    const val DIVIDER_DP = 9

    /** A preview line at 13sp, its font metrics putting a line near 1.3 times that. */
    const val PREVIEW_LINE_DP = 17

    /** What a row showed before any of this, and the floor it keeps. */
    const val MIN_PREVIEW_LINES = 2

    /** Matches `android:maxLines` on the preview in the row layout. */
    const val MAX_PREVIEW_LINES = 12

    /** The `minWidth` and `minHeight` declared in xml/cairn_widget_info.xml. */
    const val FALLBACK_HEIGHT_DP = 180
    const val FALLBACK_WIDTH_DP = 180

    /** A row's width spent on something other than preview text: vein, paddings, pin. */
    const val ROW_TEXT_INSET_DP = 40

    /** Mean advance of a character at 13sp, near half its size in a sans face. */
    const val CHAR_DP = 6.5
  }

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
