// Must come before the client is created: supabase-js relies on URL and
// URLSearchParams, which React Native's JavaScript engine lacks.
import 'react-native-url-polyfill/auto'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import type { Database } from './types'

/**
 * A variable that is present but empty counts as absent.
 *
 * It is not fussiness: `.env.example` ships precisely `EXPO_PUBLIC_SUPABASE_URL=`
 * with no value. With the `??` operator, which only falls back on null and
 * undefined, that empty string went all the way to `createClient`, which threw
 * "supabaseUrl is required" and crashed the app, where the configuration screen
 * should have shown.
 */
function readEnv(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

const url = readEnv(process.env.EXPO_PUBLIC_SUPABASE_URL)
const anonKey = readEnv(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY)

/**
 * False as long as .env is not filled in. The app then shows a configuration
 * screen instead of a blank screen or a pile of network errors.
 */
export const isSupabaseConfigured = url !== null && anonKey !== null

let client: SupabaseClient<Database> | null = null

/**
 * Deferred construction, and it is a necessity, not a preference.
 *
 * The web is exported as a static render, so components are first rendered
 * under Node. And `createClient` instantiates a Realtime client along the way,
 * which requires a global WebSocket, absent from Node before version 22. A
 * client created at module level would therefore fail the server render with an
 * error that has no apparent link to its cause.
 *
 * By deferring creation, the client only appears on the first call, which
 * always happens in an effect or an event handler, so on the browser side only.
 * No configuration to work around, and nothing Node-specific gets into the
 * bundle.
 */
export function getSupabase(): SupabaseClient<Database> {
  if (client) return client

  // Syntactically valid fallback values, so the client builds even without
  // configuration. Requests will fail, which is the intended behaviour: the
  // configuration screen explains what to do, and nothing crashes.
  client = createClient<Database>(url ?? 'http://127.0.0.1:54321', anonKey ?? 'cle-absente', {
    auth: {
      /**
       * The session token is a JWT that regularly exceeds 2048 bytes,
       * expo-secure-store's limit. So AsyncStorage is the right medium here, and
       * it is also the one Supabase documents for React Native.
       *
       * SecureStore stays reserved for what is small and truly sensitive,
       * namely the master encryption key, backed by the Android Keystore.
       *
       * On the web, supabase-js uses localStorage, its default.
       */
      storage: Platform.OS === 'web' ? undefined : AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      // The web picks up OAuth tokens from the URL fragment on returning from
      // the redirect. On mobile, the return goes through a deep link, handled
      // explicitly, so no automatic URL parsing.
      detectSessionInUrl: Platform.OS === 'web',
      flowType: 'pkce',
    },
  })

  return client
}
