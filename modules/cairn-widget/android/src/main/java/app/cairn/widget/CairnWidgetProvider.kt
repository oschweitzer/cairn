package app.cairn.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews

/**
 * The widget itself: a fixed header, with the list of notes below it.
 *
 * ── The header is on top, and that is a decision ─────────────────────────────
 * Google Keep's widget puts its create buttons in a side column. On a narrow
 * widget — two cells across, which is what most people place — that column eats
 * a third of the width for four glyphs, and the note text ends up in a corridor.
 * Along the top, the same bar costs one line's height and leaves the full width
 * to the content.
 *
 * It does not scroll: it is a `RemoteViews` in its own right, a sibling of the
 * `ListView` and not its first row. A header row slipped into the list would
 * disappear upwards on the first scroll, and the create buttons would be
 * unreachable on a long list.
 */
class CairnWidgetProvider : AppWidgetProvider() {

  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    renderAll(context, manager, ids)
  }

  override fun onDeleted(context: Context, ids: IntArray) {
    // The filter of a removed widget has no purpose left, and Android reuses
    // identifiers: leaving it behind would hand its filter to the next widget.
    ids.forEach { Snapshot.forget(context, it) }
  }

  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == ACTION_CYCLE_TAG) {
      val widgetId = intent.getIntExtra(
        AppWidgetManager.EXTRA_APPWIDGET_ID,
        AppWidgetManager.INVALID_APPWIDGET_ID,
      )
      if (widgetId != AppWidgetManager.INVALID_APPWIDGET_ID) {
        cycleTag(context, widgetId)
        val manager = AppWidgetManager.getInstance(context)
        manager.notifyAppWidgetViewDataChanged(widgetId, R.id.cairn_widget_list)
        renderAll(context, manager, intArrayOf(widgetId))
      }
      return
    }
    super.onReceive(context, intent)
  }

  /**
   * Moves to the next tag, then back to "all".
   *
   * A configuration activity would be richer and a great deal heavier: a second
   * `Activity`, its layout, its lifecycle, to pick among a handful of labels.
   * The cycle does the same job in one tap, and the current filter's name is
   * written in the header — without which you would not know what you are
   * looking at.
   */
  private fun cycleTag(context: Context, widgetId: Int) {
    val tags = Snapshot.read(context).tags
    if (tags.isEmpty()) return

    val current = Snapshot.tagFilter(context, widgetId)
    val index = tags.indexOfFirst { it.id == current }
    val next = when {
      // No filter set, or a filter pointing at a deleted tag: take the first.
      index == -1 -> tags.first().id
      index == tags.lastIndex -> ""
      else -> tags[index + 1].id
    }
    Snapshot.setTagFilter(context, widgetId, next)
  }

  companion object {

    const val ACTION_CYCLE_TAG = "app.cairn.widget.CYCLE_TAG"

    fun renderAll(context: Context, manager: AppWidgetManager, ids: IntArray) {
      ids.forEach { manager.updateAppWidget(it, render(context, it)) }
    }

    private fun render(context: Context, widgetId: Int): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.cairn_widget)
      val snapshot = Snapshot.read(context)
      val filter = Snapshot.tagFilter(context, widgetId)
      val tag = snapshot.tags.firstOrNull { it.id == filter }

      views.setTextViewText(
        R.id.cairn_widget_filter,
        tag?.name ?: context.getString(R.string.cairn_widget_all_tags),
      )

      // Creation: two deep links, one for a note, one for a checklist. The same
      // screen handles both; the kind travels in the address.
      views.setOnClickPendingIntent(
        R.id.cairn_widget_new_note,
        deepLink(context, "cairn://nouvelle?kind=note", requestCode = 1),
      )
      views.setOnClickPendingIntent(
        R.id.cairn_widget_new_list,
        deepLink(context, "cairn://nouvelle?kind=checklist", requestCode = 2),
      )
      views.setOnClickPendingIntent(R.id.cairn_widget_filter_button, cycleIntent(context, widgetId))

      /**
       * The list is filled by the service, which re-reads the snapshot on every
       * notification. The widget id travels inside the intent: that is what lets
       * two widgets placed side by side hold two different filters.
       *
       * `setRemoteAdapter(Int, Intent)` has been deprecated since API 31 in
       * favour of `RemoteCollectionItems`, which pushes already-built rows
       * instead of binding a service. We keep the service for two reasons: the
       * project's floor is API 24, where the alternative does not exist; and a
       * pushed collection has to fit inside a `RemoteViews` memory quota, which
       * a list of sixty notes is not guaranteed to do. The compiler warns, and
       * the warning is owned.
       */
      val service = Intent(context, CairnWidgetService::class.java).apply {
        putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
        // Without unique data, Android considers two intents differing only by
        // their extras to be the same one, and the two widgets would share a
        // single factory — and therefore a single filter.
        //
        // `this.data`, not `data`: inside an `apply` block a local variable of
        // the same name wins over the receiver's member. That is exactly what
        // happened here, and the compiler said so in two ways — "'val' cannot be
        // reassigned", then an expected type with no relation to anything.
        this.data = Uri.parse("cairn-widget://$widgetId")
      }
      views.setRemoteAdapter(R.id.cairn_widget_list, service)
      views.setEmptyView(R.id.cairn_widget_list, R.id.cairn_widget_empty)

      /**
       * A single intent template for the whole list.
       *
       * One `PendingIntent` per row would be refused past a few dozen items —
       * the system caps how many an app may hold. The template is filled in row
       * by row by the factory, which adds nothing to it but the note's address.
       */
      views.setPendingIntentTemplate(R.id.cairn_widget_list, openTemplate(context))

      return views
    }

    private fun deepLink(context: Context, uri: String, requestCode: Int): PendingIntent {
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri)).apply {
        `package` = context.packageName
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      return PendingIntent.getActivity(
        context,
        requestCode,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    private fun cycleIntent(context: Context, widgetId: Int): PendingIntent {
      val intent = Intent(context, CairnWidgetProvider::class.java).apply {
        action = ACTION_CYCLE_TAG
        putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
        this.data = Uri.parse("cairn-widget://filtre/$widgetId")
      }
      return PendingIntent.getBroadcast(
        context,
        widgetId,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    /**
     * Template for opening a note.
     *
     * `FLAG_MUTABLE` is mandatory here, and only here: a list template is
     * completed by the launcher with the fill-in intent of the row that was
     * touched. Immutable, it would always open the same note — the first one.
     */
    private fun openTemplate(context: Context): PendingIntent {
      val intent = Intent(Intent.ACTION_VIEW).apply {
        `package` = context.packageName
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      return PendingIntent.getActivity(
        context,
        0,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
      )
    }
  }
}
