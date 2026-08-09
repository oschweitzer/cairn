package app.cairn.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * What the JavaScript app may ask of the widget.
 *
 * Two functions, and not one more: drop off the snapshot, and find out whether
 * anyone will read it. Everything else — the layout, the filter, opening a note
 * — lives on the native side, where the launcher runs it without the app having
 * to be running at all.
 */
class CairnWidgetModule : Module() {

  override fun definition() = ModuleDefinition {
    Name("CairnWidget")

    Function("setSnapshot") { json: String ->
      val context = appContext.reactContext ?: return@Function
      Snapshot.write(context, json)

      /**
       * Two notifications, and both are needed.
       *
       * `notifyAppWidgetViewDataChanged` tells the list to re-read itself — that
       * is what refreshes the rows. But the header is not a list: it carries the
       * filter's name, which depends on the snapshot's tags. Without the
       * provider update, a renamed tag kept its old name above a list that was
       * otherwise current.
       *
       * The deprecation warning on this call goes hand in hand with
       * `setRemoteAdapter(Int, Intent)`: see why it is kept in
       * `CairnWidgetProvider.render`.
       */
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, CairnWidgetProvider::class.java))
      if (ids.isEmpty()) return@Function

      manager.notifyAppWidgetViewDataChanged(ids, R.id.cairn_widget_list)
      CairnWidgetProvider.renderAll(context, manager, ids)
    }

    Function("widgetCount") {
      val context = appContext.reactContext ?: return@Function 0
      val manager = AppWidgetManager.getInstance(context)
      manager.getAppWidgetIds(ComponentName(context, CairnWidgetProvider::class.java)).size
    }
  }
}
