import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * Petit stockage clé-valeur, volontairement pas AsyncStorage directement.
 *
 * Sur le web, AsyncStorage préfixe les clés dans localStorage. Or le script
 * anti-flash injecté dans app/+html.tsx lit localStorage avant que le bundle ne
 * soit chargé, donc avant qu'AsyncStorage existe. Les deux doivent tomber
 * d'accord sur le nom exact de la clé, d'où cet accès direct côté web.
 */

export const KEY_THEME = 'cairn.theme'

const isWeb = Platform.OS === 'web'

export async function kvGet(key: string): Promise<string | null> {
  if (isWeb) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null
    } catch {
      // Navigation privée ou stockage bloqué : on retombe sur les défauts.
      return null
    }
  }
  return AsyncStorage.getItem(key)
}

export async function kvSet(key: string, value: string): Promise<void> {
  if (isWeb) {
    try {
      globalThis.localStorage?.setItem(key, value)
    } catch {
      /* stockage indisponible, le réglage ne survivra pas au rechargement */
    }
    return
  }
  await AsyncStorage.setItem(key, value)
}

/**
 * Lecture synchrone, disponible uniquement sur le web. Permet de connaître le
 * thème dès le premier rendu, sans attendre un tour de boucle asynchrone.
 */
export function kvGetSync(key: string): string | null {
  if (!isWeb) return null
  try {
    return globalThis.localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}
