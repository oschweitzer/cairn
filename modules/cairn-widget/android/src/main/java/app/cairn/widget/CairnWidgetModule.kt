package app.cairn.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Ce que l'application JavaScript peut demander au widget.
 *
 * Deux fonctions, et pas une de plus : déposer l'instantané, et savoir si
 * quelqu'un le lira. Tout le reste — la mise en page, le filtre, l'ouverture
 * d'une note — vit du côté natif, où le lanceur l'exécute sans que
 * l'application ait besoin de tourner.
 */
class CairnWidgetModule : Module() {

  override fun definition() = ModuleDefinition {
    Name("CairnWidget")

    Function("setSnapshot") { json: String ->
      val context = appContext.reactContext ?: return@Function
      Snapshot.write(context, json)

      /**
       * Deux notifications, et il faut les deux.
       *
       * `notifyAppWidgetViewDataChanged` dit à la liste de se relire — c'est ce
       * qui rafraîchit les lignes. Mais l'en-tête, lui, n'est pas une liste :
       * il porte le nom du filtre, qui dépend des tags de l'instantané. Sans la
       * mise à jour du fournisseur, un tag renommé gardait son ancien nom
       * au-dessus d'une liste pourtant à jour.
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
