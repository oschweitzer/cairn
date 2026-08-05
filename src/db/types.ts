/**
 * Types du schéma, alignés sur supabase/migrations/20260805120000_init.sql.
 *
 * Écrits à la main pour l'instant. Dès que le projet Supabase existe, ils
 * peuvent être régénérés par `supabase gen types typescript`, ce qui supprime
 * tout risque de dérive entre le SQL et le TypeScript.
 *
 * `google_credentials` n'apparaît pas ici, et c'est volontaire : la table est
 * inaccessible au client, l'exposer dans les types serait trompeur.
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
  /** Nul si la note est chiffrée : le titre est alors dans `ciphertext`. */
  title: string | null
  body: string | null
  color_key: TagColorKey | null
  is_pinned: boolean
  is_archived: boolean
  is_private: boolean
  /** Substitué au titre partout où la note est listée. */
  code_name: string | null
  is_encrypted: boolean
  ciphertext: string | null
  nonce: string | null
  wrapped_key: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type ChecklistItem = {
  id: string
  note_id: string
  user_id: string
  content: string
  is_done: boolean
  position: number
  due_at: string | null
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

/** Métadonnées de la connexion Google. Le jeton lui-même n'est pas ici. */
export type GoogleAccount = {
  user_id: string
  google_email: string | null
  scopes: string[]
  /** En mode test Google, cette échéance tombe à 7 jours. */
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
 * Forme attendue par le client Supabase typé.
 *
 * `Relationships` est obligatoire sur chaque table : sans lui la table ne
 * satisfait pas le contrat `GenericTable` de supabase-js, et tout le schéma
 * retombe silencieusement sur `never`, ce qui se manifeste par des erreurs
 * déroutantes du type « argument non assignable au paramètre de type never » sur
 * les insert et les update. Le tableau reste vide ici puisque nous n'utilisons
 * pas les select imbriqués, seuls consommateurs de cette information.
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
      checklist_items: {
        Row: ChecklistItem
        Insert: { note_id: string; content: string } & Partial<
          Omit<ChecklistItem, 'note_id' | 'content'>
        >
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
      /** Fixe la position des éléments selon l'ordre du tableau fourni. */
      reorder_checklist_items: {
        Args: { p_note_id: string; p_ids: string[] }
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
