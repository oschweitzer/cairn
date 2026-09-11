import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Platform, useColorScheme } from 'react-native'
import * as SystemUI from 'expo-system-ui'
import { KEY_THEME, kvGet, kvGetSync, kvSet } from '../db/kv'
import { resolveTagColor, themes, type TagColorKey, type Theme, type ThemeName } from './theme'

export type ThemePreference = ThemeName | 'system'

const PREFERENCES: ThemePreference[] = ['dark', 'light', 'system']

function isPreference(value: string | null): value is ThemePreference {
  return value !== null && (PREFERENCES as string[]).includes(value)
}

type ThemeContextValue = {
  theme: Theme
  /** What the user chose, "system" included. */
  preference: ThemePreference
  setPreference: (next: ThemePreference) => void
  /** Resolves a tag palette key to the active theme's hexadecimal. */
  tagColor: (key: TagColorKey) => string
  /** False until the stored setting has been read. Used to hold the splash screen. */
  ready: boolean
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme()

  // On the web, the setting can be read synchronously, so from the first render.
  // On mobile it takes an asynchronous round trip, hence `ready`.
  const initial = kvGetSync(KEY_THEME)
  const [preference, setPreferenceState] = useState<ThemePreference>(
    isPreference(initial) ? initial : 'dark',
  )
  const [ready, setReady] = useState(Platform.OS === 'web')

  useEffect(() => {
    if (Platform.OS === 'web') return
    let cancelled = false
    kvGet(KEY_THEME).then((stored) => {
      if (cancelled) return
      if (isPreference(stored)) setPreferenceState(stored)
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Dark is Cairn's default, whatever the system says. The "system" setting is
  // the only case where the OS preference is consulted.
  const name: ThemeName =
    preference === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : preference

  const theme = themes[name]

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next)
    void kvSet(KEY_THEME, next)
  }, [])

  // Paints the background at the native level, under the React tree. Otherwise a
  // navigation bounce or a reload lets the default white show through.
  useEffect(() => {
    if (Platform.OS === 'web') {
      document.documentElement.dataset.theme = name
      return
    }
    void SystemUI.setBackgroundColorAsync(theme.surface.page)
  }, [name, theme.surface.page])

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      preference,
      setPreference,
      tagColor: (key: TagColorKey) => resolveTagColor(key, name),
      ready,
    }),
    [theme, preference, setPreference, name, ready],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme doit être appelé dans un ThemeProvider')
  return ctx
}
