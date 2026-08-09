import { useEffect, useRef } from 'react'
import { useNoteList, usePrivateNoteList } from '@/db/select'
import { useProfile, useTags } from '@/db/queries'
import {
  placedWidgetCount,
  setWidgetSnapshot,
  widgetAvailable,
} from '../../modules/cairn-widget'
import { buildSnapshot } from './snapshot'

/**
 * Tient l'instantané du widget à jour.
 *
 * Rien à l'écran : ce composant existe pour son effet. Il est monté haut dans
 * l'arbre, au-dessus des onglets, pour que l'instantané suive les notes quel que
 * soit l'écran ouvert — cocher une case depuis l'éditeur doit se voir sur
 * l'écran d'accueil du téléphone, pas seulement en repassant par la grille.
 *
 * ── Ce qui déclenche une écriture ────────────────────────────────────────────
 * Le contenu, et lui seul. Les listes composées changent d'identité à chaque
 * rendu — ce sont des tableaux reconstruits — donc les comparer par référence
 * écrirait à chaque frappe. On compare donc le JSON produit, ce qui a l'avantage
 * d'être exactement ce qui part en base de préférences : deux instantanés
 * identiques ne provoquent aucune écriture, ni aucun réveil du lanceur.
 *
 * Rien n'est écrit non plus quand aucun widget n'est posé. Sérialiser des notes
 * dans un fichier que personne ne lira n'a aucun intérêt, et en recopier le
 * contenu hors de la base pour rien en a un négatif.
 */
export function WidgetSync() {
  const { all: notes } = useNoteList()
  const { all: hidden } = usePrivateNoteList()
  const tagsQuery = useTags()
  const profileQuery = useProfile()

  /**
   * Le coffre est exclu par défaut, y compris quand le profil n'a pas encore
   * répondu. Le défaut d'un réglage de confidentialité est le plus fermé : une
   * fraction de seconde où l'on écrirait des noms de code dans un fichier de
   * préférences suffirait à les y laisser.
   */
  const showPrivate = profileQuery.data?.widget_show_private ?? false

  const lastWritten = useRef<string | null>(null)

  useEffect(() => {
    if (!widgetAvailable || placedWidgetCount() === 0) return

    const snapshot = buildSnapshot(
      showPrivate ? [...notes, ...hidden] : notes,
      tagsQuery.data ?? [],
      { showPrivate },
    )

    /**
     * L'horodatage est retiré de la comparaison, sinon il n'y en aurait aucune :
     * il change à chaque construction, et deux instantanés au contenu identique
     * paraîtraient différents. Il reste dans ce qui est écrit, où il sert à
     * savoir quand l'application a parlé au widget pour la dernière fois.
     */
    const signature = JSON.stringify({ ...snapshot, writtenAt: null })
    if (signature === lastWritten.current) return

    lastWritten.current = signature
    setWidgetSnapshot(snapshot)
  }, [notes, hidden, tagsQuery.data, showPrivate])

  return null
}
