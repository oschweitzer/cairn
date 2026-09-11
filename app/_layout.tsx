import { useCallback, useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { Stack, usePathname, useRouter, useSegments } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFonts } from 'expo-font'
import Feather from '@expo/vector-icons/Feather'
import { Archivo_400Regular, Archivo_500Medium } from '@expo-google-fonts/archivo'

import { AuthProvider, useAuth } from '@/auth/AuthProvider'
import { QueryProvider } from '@/db/QueryProvider'
import { isSupabaseConfigured } from '@/db/supabase'
import { ThemeProvider, useTheme } from '@/ui/ThemeProvider'
import { VaultProvider } from '@/vault/VaultProvider'
import { WidgetSync } from '@/widget/WidgetSync'
import { Button, Card, Logotype, Txt } from '@/ui/components'
import { ToastProvider } from '@/ui/Toast'
import { TooltipProvider } from '@/ui/Tooltip'
import { radius, space } from '@/ui/theme'

// The splash screen stays up until both the fonts AND the theme setting are
// known. Hiding it earlier would give a render in the system font and then a
// typographic jump, or a flash of the inverted theme.
//
// The splash only hides: `Boot` is what holds back the render itself, and both
// are needed — see the `canPaint` condition below.
void SplashScreen.preventAutoHideAsync()


export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    // Local files rather than packages: neither Viking nor Junicode lives on
    // Google Fonts.
    Viking: require('../assets/fonts/Viking.ttf'),
    Junicode: require('../assets/fonts/Junicode.ttf'),
    'Junicode-Bold': require('../assets/fonts/Junicode-Bold.ttf'),
    Archivo_400Regular,
    Archivo_500Medium,

    /**
     * The icon font, declared here even though `@expo/vector-icons` can load it
     * by itself. It is not a repeat: it is what makes it exist at static export
     * time too.
     *
     * Without this line, the PWA raised a hydration error on every load, of no
     * obvious origin. The icon component reads `Font.isLoaded()` in its initial
     * state, and that function does not answer the same question on both
     * sides: under Node it looks up a registry nothing had fed, in the browser
     * it looks for an `@font-face` rule in the document. So the HTML came out of
     * the build with a `<Text>` with neither `fontFamily` nor glyph, the browser
     * rendered the complete icon, and React threw away the whole tree to redo
     * it on the client.
     *
     * Declared here, `useFonts` registers it during the server render — that is
     * its `useStaticFonts` path — the export derives the `@font-face` rule it
     * puts in the HTML from it, and the browser's first render therefore finds
     * it already there. The two agree.
     *
     * A module-level call did not work: the server registry lives in an
     * `AsyncLocalStorage` that Expo only opens for the duration of the render,
     * and module evaluation comes before.
     *
     * A welcome side effect: icons no longer flicker on first render.
     */
    ...Feather.font,
  })

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <QueryProvider>
          <AuthProvider>
            {/* The vault sits under the query provider: its state gates
                queries, and closing it must be able to let the matching cache
                entries expire. */}
            <VaultProvider>
              {/* Tooltips and toasts paint above the whole app, hence their
                  place at the very top of the tree: a tooltip rendered in place
                  would be clipped by the first stratum that cuts off overflow,
                  and there are such strata everywhere. */}
              <TooltipProvider>
                <ToastProvider>
                  {/* A missing font must not hold the app on the splash screen:
                      we carry on with the system font. */}
                  <Boot fontsReady={fontsLoaded || Boolean(fontError)} />
                </ToastProvider>
              </TooltipProvider>
            </VaultProvider>
          </AuthProvider>
        </QueryProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  )
}

function Boot({ fontsReady }: { fontsReady: boolean }) {
  const { theme, ready: themeReady } = useTheme()
  const { session, loading: authLoading, recovering } = useAuth()
  const router = useRouter()
  const segments = useSegments()
  // The path rather than an indexed segment: `useSegments` returns a tuple whose
  // length varies from one route to another, and indexing into it is rejected
  // at compile time. The (auth) group does not appear in the path.
  const pathname = usePathname()

  const canPaint = fontsReady && themeReady

  useEffect(() => {
    if (canPaint) void SplashScreen.hideAsync()
  }, [canPaint])

  // Routing between the signed-in area and the sign-in screens.
  useEffect(() => {
    if (!canPaint || authLoading || !isSupabaseConfigured) return
    const inAuthGroup = segments[0] === '(auth)'

    /**
     * Recovery comes before everything else.
     *
     * The emailed link opens a valid session: the ordinary rule — a session, so
     * in you go — would send straight into the notes someone who has not yet
     * chosen their new password, and the screen asking for it would never be
     * reached. So navigation is held there, and we return early so the
     * ordinary rule does not apply.
     */
    if (recovering) {
      if (pathname !== '/new-password') router.replace('/new-password')
      return
    }

    /**
     * Outside recovery, this screen has nothing left to ask: we leave it.
     *
     * Without this rule it became a dead end, not being covered by the next two
     * rules — it belongs to the (auth) group, so "no session and outside the
     * group" does not apply to it. The « Annuler et se déconnecter » button did
     * close the session, but left you in place, facing a form no session could
     * submit any more. Seen while walking through the flow; that button's
     * comment promised exactly the opposite.
     */
    if (pathname === '/new-password') {
      router.replace(session ? '/' : '/sign-in')
      return
    }

    if (!session && !inAuthGroup) router.replace('/sign-in')
    else if (session && inAuthGroup) router.replace('/')
  }, [canPaint, authLoading, session, recovering, segments, pathname, router])

  const needsSetup = !isSupabaseConfigured
  const [setupDismissed, setSetupDismissed] = useState(false)

  /**
   * Nothing is rendered while fonts are missing — not even under the splash.
   *
   * Holding the splash screen was not enough: it hides the first render, it
   * does not prevent it. So the tree was measured in the system font, and
   * Android keeps that measurement when the real font arrives afterwards. Every
   * text ended up painted in a box cut for another design: the logotype,
   * measured at 71 points then drawn in Viking which needs 107, broke after
   * "CAI" — the rest went to a second line, outside the reserved height, so
   * invisible — and tab labels shortened to « Not… ».
   *
   * On the web the condition is already true on first render — the @font-face
   * rules come out of the static export and the theme setting is read
   * synchronously there — so hydration sees the same tree on both sides.
   */
  if (!canPaint) return <View style={{ flex: 1, backgroundColor: theme.surface.page }} />

  /**
   * The order of the two setup elements is not interchangeable, and each needs
   * its own.
   *
   * The collapsed banner comes BEFORE the stack so it takes its own place in
   * the column and pushes the content down: overlaid, it hid the editor's
   * action bar, back button included.
   *
   * The full overlay comes AFTER the stack, because among overlapping siblings
   * the last rendered is painted on top. Placed before, it went under the stack
   * and became invisible.
   */
  return (
    <View style={{ flex: 1, backgroundColor: theme.surface.page }}>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />

      {/* Nothing on screen: keeps the snapshot the Android widget reads up to
          date. Here rather than in a tab, so the copy follows the notes
          whatever screen is open — ticking a box from the editor has to show
          on the phone's home screen. */}
      <WidgetSync />

      {needsSetup && setupDismissed ? (
        <SetupBanner onPress={() => setSetupDismissed(false)} />
      ) : null}

      {/* A stack, not a Slot: the note editor is pushed on top of the tabs and
          must be able to go back.

          The two screens that open onto something other than a list have
          their own transition. Declaring only some of the routes is supported:
          the ones left out keep the platform's default transition, they do not
          drop out of the stack. */}
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.surface.page },
        }}
      >
        {/* The note rises into place rather than arriving from the side: you
            open a stone from the pile, you do not move on to the next screen. */}
        <Stack.Screen name="note/[id]" options={{ animation: 'fade_from_bottom' }} />
        {/* The vault is the only screen painted on the recessed stratum. A fade
            lets the light change in place, which a sideways slide would tell
            badly: you do not go next door, you enter the rock. */}
        <Stack.Screen name="vault" options={{ animation: 'fade' }} />
      </Stack>

      {needsSetup && !setupDismissed ? (
        <SetupOverlay onDismiss={() => setSetupDismissed(true)} />
      ) : null}
    </View>
  )
}

/** A discreet reminder, in normal flow, once the overlay is dismissed. */
function SetupBanner({ onPress }: { onPress: () => void }) {
  const { theme } = useTheme()
  const insets = useSafeAreaInsets()

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Afficher les consignes de configuration"
      onPress={onPress}
      style={{
        marginTop: insets.top + space.sm,
        marginHorizontal: space.md,
        marginBottom: space.xs,
        minHeight: 48,
        justifyContent: 'center',
        paddingHorizontal: space.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: theme.accent.default,
        backgroundColor: theme.accent.subtle,
      }}
    >
      <Txt variant="caption" tone="accent">
        Mode démonstration, aucun projet Supabase configuré. Toucher pour la marche à suivre.
      </Txt>
    </Pressable>
  )
}

/**
 * Shown as long as .env is not filled in. A clear instruction beats a blank
 * screen or a pile of incomprehensible network errors.
 *
 * Dismissable on purpose: without a Supabase project, an opaque overlay would
 * make the shell and the themes impossible to inspect. The banner above takes
 * over so the warning does not disappear for all that.
 */
function SetupOverlay({ onDismiss }: { onDismiss: () => void }) {
  const { theme } = useTheme()

  const step = useCallback(
    (n: string, text: string) => (
      <View key={n} style={{ flexDirection: 'row', gap: space.sm }}>
        <Txt variant="label" tone="accent">
          {n}
        </Txt>
        <Txt variant="body" tone="secondary" style={{ flex: 1 }}>
          {text}
        </Txt>
      </View>
    ),
    [],
  )

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: theme.surface.page,
        justifyContent: 'center',
        padding: space.xl,
        gap: space.md,
      }}
    >
      <Card style={{ gap: space.md }}>
        <Logotype />
        <Txt variant="title">Configuration à terminer</Txt>
        <Txt variant="body" tone="secondary">
          L’application ne sait pas encore à quel projet Supabase parler.
        </Txt>
        {step('1', 'Créer un projet gratuit sur supabase.com.')}
        {step('2', 'Copier .env.example vers .env, y coller l’URL et la clé anon du projet.')}
        {step('3', 'Appliquer supabase/migrations/ dans l’éditeur SQL du tableau de bord.')}
        {step('4', 'Relancer le serveur de développement.')}
        <Txt variant="caption" tone="muted">
          Le détail figure dans le README, section Mise en route.
        </Txt>
      </Card>
      <Button label="Regarder l’interface quand même" variant="ghost" onPress={onDismiss} />
    </View>
  )
}
