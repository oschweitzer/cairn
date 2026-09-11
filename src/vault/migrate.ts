import { getSupabase } from '../db/supabase'
import { hasDataKey, sealItem, sealNote } from './keyring'

/**
 * Encrypts what was already filed in the vault before encryption existed.
 *
 * Without this pass, turning encryption on would only protect notes to come and
 * would leave the old ones in plaintext in the database — that is, exactly the
 * ones someone had seen fit to file there.
 *
 * ── Note by note, and not in one transaction ─────────────────────────────────
 * PostgREST offers no transaction over a batch of different updates, each note
 * receiving its own sealed blob. So a cut along the way leaves a half-encrypted
 * vault — and that is harmless: `is_encrypted` is carried by the row, reading
 * handles both cases, and running the operation again resumes where it stopped
 * since only what is still in plaintext is selected. Order does matter, though:
 * the content is sealed before the flag declares it, in the same write.
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
