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

// L'écran de démarrage reste affiché jusqu'à ce que les polices ET le réglage de
// thème soient connus. Le masquer plus tôt donnerait un rendu en police système
// puis un saut typographique, ou un éclair de thème inversé.
void SplashScreen.preventAutoHideAsync()


export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    // Fichiers locaux plutôt que paquets : ni Viking ni Junicode ne vivent sur
    // Google Fonts.
    Viking: require('../assets/fonts/Viking.ttf'),
    Junicode: require('../assets/fonts/Junicode.ttf'),
    'Junicode-Bold': require('../assets/fonts/Junicode-Bold.ttf'),
    Archivo_400Regular,
    Archivo_500Medium,

    /**
     * La police des icônes, déclarée ici alors que `@expo/vector-icons` sait la
     * charger tout seul. Ce n'est pas une redite : c'est ce qui fait qu'elle
     * existe aussi au moment de l'export statique.
     *
     * Sans cette ligne, la PWA levait une erreur d'hydratation à chaque
     * chargement, d'origine peu évidente. Le composant d'icône lit
     * `Font.isLoaded()` dans son état initial, or cette fonction ne répond pas à
     * la même question des deux côtés : sous Node elle consulte un registre que
     * rien n'avait alimenté, dans le navigateur elle cherche une règle
     * `@font-face` dans le document. Le HTML sortait donc du build avec un
     * `<Text>` sans `fontFamily` ni glyphe, le navigateur rendait l'icône
     * complète, et React jetait tout l'arbre pour le refaire côté client.
     *
     * Déclarée ici, `useFonts` l'enregistre pendant le rendu serveur — c'est son
     * chemin `useStaticFonts` — l'export en tire la règle `@font-face` qu'il
     * pose dans le HTML, et le premier rendu du navigateur la trouve donc déjà
     * là. Les deux concordent.
     *
     * Un appel au niveau module ne marchait pas : le registre serveur vit dans
     * un `AsyncLocalStorage` qu'Expo n'ouvre que le temps du rendu, et
     * l'évaluation du module arrive avant.
     *
     * Effet de bord bienvenu : les icônes ne clignotent plus au premier rendu.
     */
    ...Feather.font,
  })

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <QueryProvider>
          <AuthProvider>
            {/* Le coffre est sous le fournisseur de requêtes : son état
                conditionne des requêtes, et refermer doit pouvoir laisser
                expirer les entrées de cache correspondantes. */}
            <VaultProvider>
              {/* Infobulles et accusés de réception se peignent au-dessus de
                  toute l'application, d'où leur place tout en haut de l'arbre :
                  une bulle rendue sur place serait rognée par la première strate
                  qui coupe ce qui dépasse, et il y en a partout. */}
              <TooltipProvider>
                <ToastProvider>
                  {/* Une police introuvable ne doit pas bloquer l'application sur
                      l'écran de démarrage : on continue avec la police système. */}
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
  // Le chemin plutôt qu'un segment indexé : `useSegments` rend un tuple dont la
  // longueur varie d'une route à l'autre, et un index y est refusé à la
  // compilation. Le groupe (auth) n'apparaît pas dans le chemin.
  const pathname = usePathname()

  const canPaint = fontsReady && themeReady

  useEffect(() => {
    if (canPaint) void SplashScreen.hideAsync()
  }, [canPaint])

  // Aiguillage entre la zone authentifiée et les écrans de connexion.
  useEffect(() => {
    if (!canPaint || authLoading || !isSupabaseConfigured) return
    const inAuthGroup = segments[0] === '(auth)'

    /**
     * La récupération passe avant tout le reste.
     *
     * Le lien reçu par courriel ouvre une session valide : la règle ordinaire —
     * une session, donc on entre — enverrait droit dans les notes quelqu'un qui
     * n'a pas encore choisi son nouveau mot de passe, et l'écran qui le demande
     * ne serait jamais atteint. On y retient donc la navigation, et on sort tôt
     * pour que la règle ordinaire ne s'applique pas.
     */
    if (recovering) {
      if (pathname !== '/new-password') router.replace('/new-password')
      return
    }

    /**
     * Hors récupération, cet écran n'a plus rien à demander : on en sort.
     *
     * Sans cette règle il devenait un cul-de-sac, faute d'être couvert par les
     * deux règles suivantes — il appartient au groupe (auth), donc « pas de
     * session et hors du groupe » ne s'y applique pas. Le bouton « Annuler et se
     * déconnecter » fermait donc bien la session, mais laissait sur place, face
     * à un formulaire que plus aucune session ne permettait d'envoyer. Vu en
     * éprouvant le parcours ; le commentaire de ce bouton promettait exactement
     * l'inverse.
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
   * L'ordre des deux éléments de configuration n'est pas interchangeable, et
   * chacun a besoin du sien.
   *
   * Le bandeau réduit vient AVANT la pile pour occuper sa propre place dans la
   * colonne et pousser le contenu : en superposition il masquait la barre
   * d'actions de l'éditeur, bouton retour compris.
   *
   * Le voile complet vient APRÈS la pile, parce qu'entre frères superposés c'est
   * le dernier rendu qui est peint au-dessus. Placé avant, il passait sous la
   * pile et devenait invisible.
   */
  return (
    <View style={{ flex: 1, backgroundColor: theme.surface.page }}>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />

      {/* Rien à l'écran : tient à jour l'instantané que lit le widget Android.
          Ici plutôt que dans un onglet, pour que la copie suive les notes quel
          que soit l'écran ouvert — cocher une case depuis l'éditeur doit se voir
          sur l'écran d'accueil du téléphone. */}
      <WidgetSync />

      {needsSetup && setupDismissed ? (
        <SetupBanner onPress={() => setSetupDismissed(false)} />
      ) : null}

      {/* Une pile, pas un Slot : l'éditeur de note est poussé par-dessus les
          onglets et doit pouvoir revenir en arrière.

          Les deux écrans qui s'ouvrent sur autre chose qu'une liste ont leur
          propre transition. Déclarer une partie des routes seulement est prévu :
          celles qui ne le sont pas gardent la transition par défaut de la
          plateforme, elles ne disparaissent pas de la pile. */}
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.surface.page },
        }}
      >
        {/* La note monte à sa place plutôt que d'arriver par le côté : on ouvre
            une pierre de la pile, on ne passe pas à l'écran suivant. */}
        <Stack.Screen name="note/[id]" options={{ animation: 'fade_from_bottom' }} />
        {/* Le coffre est le seul écran peint sur la strate creusée. Un fondu
            laisse la lumière changer sur place, ce qu'un glissement latéral
            raconterait mal : on ne va pas à côté, on entre dans la roche. */}
        <Stack.Screen name="vault" options={{ animation: 'fade' }} />
      </Stack>

      {needsSetup && !setupDismissed ? (
        <SetupOverlay onDismiss={() => setSetupDismissed(true)} />
      ) : null}
    </View>
  )
}

/** Rappel discret, en flux normal, une fois le voile écarté. */
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
 * Affiché tant que .env n'est pas rempli. Mieux vaut une consigne claire qu'un
 * écran blanc ou une pile d'erreurs réseau incompréhensibles.
 *
 * Écartable volontairement : sans projet Supabase, un voile opaque rendrait la
 * coquille et les thèmes impossibles à inspecter. Le bandeau ci-dessus prend le
 * relais pour que l'avertissement ne disparaisse pas pour autant.
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
