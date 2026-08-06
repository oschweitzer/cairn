import { getSupabase } from '../db/supabase'
import { hasDataKey, sealItem, sealNote } from './keyring'

/**
 * Chiffre ce qui était déjà rangé dans le coffre avant que le chiffrement
 * n'existe.
 *
 * Sans ce passage, activer le chiffrement ne protégerait que les notes à venir
 * et laisserait les anciennes en clair dans la base — c'est-à-dire exactement
 * celles qu'on avait jugé bon de ranger là.
 *
 * ── Note par note, et non en une transaction ────────────────────────────────
 * PostgREST n'offre pas de transaction sur un lot de mises à jour différentes,
 * chaque note recevant son propre scellé. Une coupure en cours de route laisse
 * donc un coffre à moitié chiffré — et c'est sans gravité : `is_encrypted` est
 * porté par la ligne, la lecture traite les deux cas, et relancer l'opération
 * reprend là où elle s'était arrêtée puisqu'on ne sélectionne que ce qui reste
 * en clair. L'ordre compte en revanche : le contenu est scellé avant que le
 * drapeau ne le déclare, dans la même écriture.
 */
export async function encryptExistingVaultNotes(): Promise<{ notes: number; items: number }> {
  if (!hasDataKey()) throw new Error('Clé de données absente : rien ne peut être chiffré.')
  const supabase = getSupabase()

  const { data: notes, error } = await supabase
    .from('notes')
    .select('id, title, body')
    .eq('is_private', true)
    .eq('is_encrypted', false)
    .is('deleted_at', null)
  if (error) throw error

  let sealedNotes = 0
  for (const note of notes ?? []) {
    const sealed = sealNote({ title: note.title, body: note.body })
    if (!sealed) continue
    const { error: writeError } = await supabase
      .from('notes')
      .update({ is_encrypted: true, ciphertext: sealed, title: null, body: null })
      .eq('id', note.id)
    if (writeError) throw writeError
    sealedNotes += 1
  }

  const noteIds = (notes ?? []).map((n) => n.id)
  let sealedItems = 0
  if (noteIds.length > 0) {
    const { data: items, error: itemsError } = await supabase
      .from('checklist_items')
      .select('id, content')
      .in('note_id', noteIds)
      .eq('is_encrypted', false)
    if (itemsError) throw itemsError

    for (const item of items ?? []) {
      const sealed = item.content ? sealItem(item.content) : null
      if (!sealed) continue
      const { error: writeError } = await supabase
        .from('checklist_items')
        .update({ is_encrypted: true, ciphertext: sealed, content: null })
        .eq('id', item.id)
      if (writeError) throw writeError
      sealedItems += 1
    }
  }

  return { notes: sealedNotes, items: sealedItems }
}
