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
 * Alimente la liste du widget.
 *
 * Le lanceur se connecte à ce service, lui demande une `RemoteViews` par ligne,
 * et les affiche dans son propre processus. Rien de tout cela ne fait tourner
 * l'application : c'est pour cette raison que le widget s'affiche instantanément,
 * même après un redémarrage du téléphone.
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
   * Relit l'instantané et applique le filtre.
   *
   * Appelée par le système à chaque `notifyAppWidgetViewDataChanged`, hors du
   * fil principal : c'est l'endroit prévu pour le travail de lecture, et le seul
   * où l'on a le droit d'en faire.
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

    // Une note sans titre n'affiche pas une ligne vide : elle annonce ce qu'elle
    // est. C'est aussi le cas d'une note du coffre sans nom de code, qui ne doit
    // surtout pas se rabattre sur son titre.
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
     * La veine colorée, comme sur les cartes de la grille.
     *
     * Un filet sur le bord gauche, et non un fond teinté : la palette de tags
     * est calibrée pour des puces et des bordures, pas pour porter du texte
     * par-dessus. Le même raisonnement que dans `NoteCard`, et la même raison de
     * ne pas y déroger ici — le widget n'a pas de thème à lui, il est peint sur
     * le fond du lanceur.
     */
    val vein = tagColor(note.color)
    if (vein == null) {
      row.setViewVisibility(R.id.cairn_item_vein, View.INVISIBLE)
    } else {
      row.setViewVisibility(R.id.cairn_item_vein, View.VISIBLE)
      row.setInt(R.id.cairn_item_vein, "setBackgroundColor", vein)
    }

    // Remplit le gabarit posé par le fournisseur : seule l'adresse change d'une
    // ligne à l'autre.
    row.setOnClickFillInIntent(
      R.id.cairn_item_root,
      Intent().setData(Uri.parse("cairn://note/${note.id}")),
    )

    return row
  }

  override fun getLoadingView(): RemoteViews? = null

  override fun getViewTypeCount() = 1

  /**
   * L'identifiant de la note, et non sa position.
   *
   * Avec la position, le lanceur croit que la ligne 3 est toujours la même note
   * et recycle sa vue telle quelle : après un réordonnancement, l'ancienne note
   * restait affichée à sa place jusqu'au prochain défilement.
   */
  override fun getItemId(position: Int) =
    notes.getOrNull(position)?.id?.hashCode()?.toLong() ?: position.toLong()

  override fun hasStableIds() = true

  /**
   * Palette de tags, en dur et assumée.
   *
   * Les valeurs viennent de `tagPalette` dans src/ui/theme.ts, variante sombre.
   * Ce sont les seules couleurs du projet recopiées à la main hors du
   * générateur : une `RemoteViews` ne peut pas lire une ressource par son nom
   * calculé, il faut un entier. Le test `npm run theme:check` couvre les
   * ressources générées, pas celles-ci — d'où le commentaire, et la règle : une
   * teinte modifiée dans theme.ts se reporte ici.
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
