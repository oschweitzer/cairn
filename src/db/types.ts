/**
 * Schema types, aligned with supabase/migrations/20260805120000_init.sql.
 *
 * Written by hand for now. As soon as the Supabase project exists, they can be
 * regenerated with `supabase gen types typescript`, which removes any risk of
 * drift between the SQL and the TypeScript.
 *
 * `google_credentials` does not appear here, on purpose: the table is out of
 * the client's reach, and exposing it in the types would be misleading.
 */

import type { TagColorKey } from '../ui/theme'

export type NoteKind = 'note' | 'checklist'
export type GoogleTarget = 'task' | 'event'
export type SyncState = 'pending' | 'synced' | 'error' | 'disabled'
export type ThemePreference = 'dark' | 'light' | 'system'

export type Note = {
  id: string
  user_id: string
  kind: NoteKind
  /** Null if the note is encrypted: the title is then in `ciphertext`. */
  title: string | null
  body: string | null
  color_key: TagColorKey | null
  is_pinned: boolean
  is_archived: boolean
  is_private: boolean
  /** Rank chosen in the grid. Zero by default, ties broken by `updated_at`. */
  position: number
  /** Substituted for the title wherever the note is listed. */
  code_name: string | null
  /** The vault card shows the code name alone. Masking, not encryption. */
  hide_content: boolean
  is_encrypted: boolean
  /** Nonce first, ciphertext after. See src/vault/crypto.ts. */
  ciphertext: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type ChecklistItem = {
  id: string
  note_id: string
  user_id: string
  /** Null if the item is encrypted: the content is then in `ciphertext`. */
  content: string | null
  is_encrypted: boolean
  ciphertext: string | null
  is_done: boolean
  position: number
  due_at: string | null
  created_at: string
  updated_at: string
}

/**
 * A list item as the interface handles it, once the ciphertext is opened: the
 * content is always readable there. The row type, for its part, keeps a null
 * content, because that is what the database actually holds for an encrypted
 * item. Mixing them up would carry `null` all the way into the text fields,
 * which the compiler flagged straight away.
 */
export type PlainChecklistItem = Omit<ChecklistItem, 'content'> & { content: string }

/**
 * The vault's data key, sealed by the user's recovery key. One row per person,
 * unusable without the recovery key.
 */
export type VaultKey = {
  user_id: string
  wrapped_key: string
  created_at: string
  updated_at: string
}

export type Tag = {
  id: string
  user_id: string
  name: string
  color_key: TagColorKey
  position: number
  created_at: string
}

export type NoteTag = {
  note_id: string
  tag_id: string
  user_id: string
}

export type Reminder = {
  id: string
  user_id: string
  note_id: string | null
  checklist_item_id: string | null
  remind_at: string
  local_notification_id: string | null
  google_kind: GoogleTarget | null
  google_id: string | null
  sync_state: SyncState
  last_error: string | null
  last_synced_at: string | null
  attempts: number
  created_at: string
  updated_at: string
}

/** Metadata of the Google connection. The token itself is not here. */
export type GoogleAccount = {
  user_id: string
  google_email: string | null
  scopes: string[]
  /** In Google's test mode, this expiry falls at 7 days. */
  refresh_expires_at: string | null
  needs_reauth: boolean
  connected_at: string
  updated_at: string
}

export type Profile = {
  id: string
  theme_preference: ThemePreference
  widget_force_dark: boolean
  widget_show_private: boolean
  created_at: string
  updated_at: string
}

/**
 * The shape the typed Supabase client expects.
 *
 * `Relationships` is mandatory on every table: without it the table does not
 * satisfy supabase-js's `GenericTable` contract, and the whole schema silently
 * falls back to `never`, which shows up as baffling errors such as "argument not
 * assignable to parameter of type never" on inserts and updates. The array stays
 * empty here since we do not use nested selects, the only consumers of this
 * information.
 */
type Rel = []

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: { id: string } & Partial<Omit<Profile, 'id'>>
        Update: Partial<Profile>
        Relationships: Rel
      }
      notes: {
        Row: Note
        Insert: Partial<Note>
        Update: Partial<Note>
        Relationships: Rel
      }
      vault_keys: {
        Row: VaultKey
        Insert: { wrapped_key: string } & Partial<Omit<VaultKey, 'wrapped_key'>>
        Update: Partial<VaultKey>
        Relationships: Rel
      }
      checklist_items: {
        Row: ChecklistItem
        // `content` is no longer mandatory on insert: an encrypted item has none.
        // The `encrypted_item_has_no_plaintext` SQL constraint is what
        // guarantees there is one or the other, and never neither — holding
        // that invariant is the database's job, not the type's.
        Insert: { note_id: string } & Partial<Omit<ChecklistItem, 'note_id'>>
        Update: Partial<ChecklistItem>
        Relationships: Rel
      }
      tags: {
        Row: Tag
        Insert: { name: string } & Partial<Omit<Tag, 'name'>>
        Update: Partial<Tag>
        Relationships: Rel
      }
      note_tags: {
        Row: NoteTag
        Insert: { note_id: string; tag_id: string; user_id?: string }
        Update: Partial<NoteTag>
        Relationships: Rel
      }
      reminders: {
        Row: Reminder
        Insert: { remind_at: string } & Partial<Omit<Reminder, 'remind_at'>>
        Update: Partial<Reminder>
        Relationships: Rel
      }
      google_accounts: {
        Row: GoogleAccount
        Insert: { user_id: string } & Partial<Omit<GoogleAccount, 'user_id'>>
        Update: Partial<GoogleAccount>
        Relationships: Rel
      }
    }
    Views: Record<string, never>
    Functions: {
      /** Sets the items' positions according to the order of the given array. */
      reorder_checklist_items: {
        Args: { p_note_id: string; p_ids: string[] }
        Returns: undefined
      }
      /** Sets the notes' ranks according to the order of the given array. */
      reorder_notes: {
        Args: { p_ids: string[] }
        Returns: undefined
      }
      /**
       * Deletes the caller's account, and all its data by cascade. No argument,
       * by design: the identity is read from the session on the database side,
       * so there is no id to forge from here.
       */
      delete_own_account: {
        Args: Record<string, never>
        Returns: undefined
      }
    }
    Enums: {
      note_kind: NoteKind
      tag_color: TagColorKey
      google_target: GoogleTarget
      sync_state: SyncState
      theme_preference: ThemePreference
    }
    CompositeTypes: Record<string, never>
  }
}
