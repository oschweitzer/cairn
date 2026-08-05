// Doit précéder la création du client : supabase-js s'appuie sur URL et
// URLSearchParams, absents du moteur JavaScript de React Native.
import 'react-native-url-polyfill/auto'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import type { Database } from './types'

/**
 * Une variable présente mais vide compte comme absente.
 *
 * Ce n'est pas de la coquetterie : `.env.example` livre justement
 * `EXPO_PUBLIC_SUPABASE_URL=` sans valeur. Avec l'opérateur `??`, qui ne se replie
 * que sur null et undefined, cette chaîne vide traversait jusqu'à `createClient`
 * qui levait « supabaseUrl is required » et plantait l'application, là où l'écran
 * de configuration aurait dû s'afficher.
 */
function readEnv(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

const url = readEnv(process.env.EXPO_PUBLIC_SUPABASE_URL)
const anonKey = readEnv(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY)

/**
 * Faux tant que .env n'est pas rempli. L'application affiche alors un écran de
 * configuration au lieu d'un écran blanc ou d'une pile d'erreurs réseau.
 */
export const isSupabaseConfigured = url !== null && anonKey !== null

let client: SupabaseClient<Database> | null = null

/**
 * Construction différée, et c'est une nécessité, pas une préférence.
 *
 * Le web est exporté en rendu statique, donc les composants sont d'abord rendus
 * sous Node. Or `createClient` instancie au passage un client Realtime qui exige
 * un WebSocket global, absent de Node avant la version 22. Un client créé au
 * niveau module ferait donc échouer le rendu serveur avec une erreur qui n'a
 * aucun rapport apparent avec la cause.
 *
 * En différant la création, le client n'apparaît qu'au premier appel, lequel a
 * toujours lieu dans un effet ou un gestionnaire d'évènement, donc côté
 * navigateur uniquement. Aucune configuration à contourner, et rien de spécifique
 * à Node ne rentre dans le bundle.
 */
export function getSupabase(): SupabaseClient<Database> {
  if (client) return client

  // Valeurs de repli syntaxiquement valides, pour que le client se construise
  // même sans configuration. Les requêtes échoueront, ce qui est le comportement
  // voulu : l'écran de configuration explique quoi faire, et rien ne plante.
  client = createClient<Database>(url ?? 'http://127.0.0.1:54321', anonKey ?? 'cle-absente', {
    auth: {
      /**
       * Le jeton de session est un JWT qui dépasse régulièrement les 2048 octets,
       * limite d'expo-secure-store. AsyncStorage est donc le bon support ici, et
       * c'est aussi celui que documente Supabase pour React Native.
       *
       * SecureStore reste réservé à ce qui est petit et vraiment sensible, à
       * savoir la clé maîtresse de chiffrement, adossée au Keystore Android.
       *
       * Sur le web, supabase-js utilise localStorage, son défaut.
       */
      storage: Platform.OS === 'web' ? undefined : AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      // Le web récupère les jetons OAuth dans le fragment d'URL au retour de
      // redirection. Sur mobile, le retour passe par un lien profond, traité
      // explicitement, donc pas d'analyse d'URL automatique.
      detectSessionInUrl: Platform.OS === 'web',
      flowType: 'pkce',
    },
  })

  return client
}
