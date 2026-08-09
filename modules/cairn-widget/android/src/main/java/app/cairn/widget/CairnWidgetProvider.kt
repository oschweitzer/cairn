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
 * Le widget lui-même : un en-tête fixe, et dessous la liste des notes.
 *
 * ── L'en-tête est en haut, et c'est un choix ─────────────────────────────────
 * Le widget de Google Keep range ses boutons de création dans une colonne
 * latérale. Sur un widget étroit — deux cases de large, ce que la plupart des
 * gens posent — cette colonne mange un tiers de la largeur pour quatre
 * pictogrammes, et le texte des notes se retrouve dans un couloir. En haut, la
 * même barre coûte une hauteur de ligne et laisse toute la largeur au contenu.
 *
 * Elle ne défile pas : c'est une `RemoteViews` de plein droit, sœur de la
 * `ListView` et non sa première ligne. Une ligne d'en-tête glissée dans la liste
 * partirait vers le haut au premier défilement, et les boutons de création
 * seraient introuvables sur une longue liste.
 */
class CairnWidgetProvider : AppWidgetProvider() {

  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    renderAll(context, manager, ids)
  }

  override fun onDeleted(context: Context, ids: IntArray) {
    // Le filtre d'un widget retiré n'a plus d'objet, et Android réattribue les
    // identifiants : le laisser traîner donnerait son filtre au prochain widget.
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
   * Passe au tag suivant, puis revient à « tous ».
   *
   * Une activité de configuration serait plus riche et beaucoup plus lourde :
   * une seconde `Activity`, sa mise en page, son cycle de vie, pour choisir
   * parmi une poignée d'étiquettes. Le cycle fait le même travail en un appui,
   * et le nom du filtre en cours est écrit dans l'en-tête — sans quoi on ne
   * saurait pas ce qu'on regarde.
   */
  private fun cycleTag(context: Context, widgetId: Int) {
    val tags = Snapshot.read(context).tags
    if (tags.isEmpty()) return

    val current = Snapshot.tagFilter(context, widgetId)
    val index = tags.indexOfFirst { it.id == current }
    val next = when {
      // Aucun filtre posé, ou filtre pointant un tag supprimé : on prend le premier.
      index == -1 -> tags.first().id
      index == tags.lastIndex -> ""
      else -> tags[index + 1].id
    }
    Snapshot.setTagFilter(context, widgetId, next)
  }

  companion object {

    const val ACTION_CYCLE_TAG = "app.cairn.widget.CYCLE_TAG"
    const val ACTION_OPEN_NOTE = "app.cairn.widget.OPEN_NOTE"
    const val EXTRA_NOTE_ID = "noteId"

    fun renderAll(context: Context, manager: AppWidgetManager, ids: IntArray) {
      ids.forEach { manager.updateAppWidget(it, render(context, it)) }
    }

    private fun render(context: Context, widgetId: Int): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.cairn_widget)
      val data = Snapshot.read(context)
      val filter = Snapshot.tagFilter(context, widgetId)
      val tag = data.tags.firstOrNull { it.id == filter }

      views.setTextViewText(
        R.id.cairn_widget_filter,
        tag?.name ?: context.getString(R.string.cairn_widget_all_tags),
      )

      // Création : deux liens profonds, l'un pour une note, l'autre pour une
      // liste. Le même écran les traite, le type voyage dans l'adresse.
      views.setOnClickPendingIntent(
        R.id.cairn_widget_new_note,
        deepLink(context, "cairn://nouvelle?kind=note", requestCode = 1),
      )
      views.setOnClickPendingIntent(
        R.id.cairn_widget_new_list,
        deepLink(context, "cairn://nouvelle?kind=checklist", requestCode = 2),
      )
      views.setOnClickPendingIntent(R.id.cairn_widget_filter_button, cycleIntent(context, widgetId))

      // La liste est peuplée par le service, qui relit l'instantané à chaque
      // notification. L'identifiant du widget voyage dans l'intention : c'est ce
      // qui permet à deux widgets posés côte à côte d'avoir deux filtres.
      val service = Intent(context, CairnWidgetService::class.java).apply {
        putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
        // Sans une donnée unique, Android considère que deux intentions ne
        // différant que par leurs extras sont la même, et les deux widgets
        // partageraient la même fabrique — donc le même filtre.
        data = Uri.parse("cairn-widget://$widgetId")
      }
      views.setRemoteAdapter(R.id.cairn_widget_list, service)
      views.setEmptyView(R.id.cairn_widget_list, R.id.cairn_widget_empty)

      /**
       * Un seul gabarit d'intention pour toute la liste.
       *
       * Une `PendingIntent` par ligne serait refusée au-delà de quelques
       * dizaines d'éléments — le système en limite le nombre par application.
       * Le gabarit est rempli ligne par ligne par la fabrique, qui n'y ajoute
       * que l'identifiant de la note.
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
        data = Uri.parse("cairn-widget://filtre/$widgetId")
      }
      return PendingIntent.getBroadcast(
        context,
        widgetId,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    /**
     * Gabarit d'ouverture d'une note.
     *
     * `FLAG_MUTABLE` est obligatoire ici, et c'est le seul endroit : un gabarit
     * de liste est complété par le lanceur avec l'intention de remplissage de la
     * ligne touchée. Immuable, il ouvrirait toujours la même note — la première.
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
