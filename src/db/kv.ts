import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * A small key-value store, deliberately not AsyncStorage directly.
 *
 * On the web, AsyncStorage prefixes keys in localStorage. And the anti-flash
 * script injected in app/+html.tsx reads localStorage before the bundle is
 * loaded, so before AsyncStorage exists. The two have to agree on the exact key
 * name, hence this direct access on the web.
 */

export const KEY_THEME = 'cairn.theme'

const isWeb = Platform.OS === 'web'

export async function kvGet(key: string): Promise<string | null> {
  if (isWeb) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null
    } catch {
      // Private browsing or blocked storage: we fall back on the defaults.
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
      /* storage unavailable, the setting will not survive a reload */
    }
    return
  }
  await AsyncStorage.setItem(key, value)
}

/**
 * Synchronous read, available on the web only. Lets the theme be known from the
 * first render, without waiting for an asynchronous turn of the loop.
 */
export function kvGetSync(key: string): string | null {
  if (!isWeb) return null
  try {
    return globalThis.localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}
