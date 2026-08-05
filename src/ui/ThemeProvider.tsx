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
  /** Ce que l'utilisateur a choisi, y compris « système ». */
  preference: ThemePreference
  setPreference: (next: ThemePreference) => void
  /** Résout une clé de palette de tag vers l'hexadécimal du thème actif. */
  tagColor: (key: TagColorKey) => string
  /** Faux jusqu'à la lecture du réglage stocké. Sert à retenir l'écran de démarrage. */
  ready: boolean
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme()

  // Sur le web, le réglage est lisible de façon synchrone, donc dès le premier
  // rendu. Sur mobile il faut un aller-retour asynchrone, d'où `ready`.
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

  // Le sombre est le défaut de Cairn, quoi que dise le système. Le réglage
  // « système » est le seul cas où la préférence de l'OS est consultée.
  const name: ThemeName =
    preference === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : preference

  const theme = themes[name]

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next)
    void kvSet(KEY_THEME, next)
  }, [])

  // Peint le fond au niveau natif, sous l'arbre React. Sans cela, un
  // rebond de navigation ou un rechargement laisse apparaître le blanc par défaut.
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
