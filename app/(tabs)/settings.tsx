import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { useRouter } from 'expo-router'
import Feather from '@expo/vector-icons/Feather'
import { useAuth } from '@/auth/AuthProvider'
import { useVault } from '@/vault/VaultProvider'
import { useTheme, type ThemePreference } from '@/ui/ThemeProvider'
import { Button, Card, Inscription, Screen, Seam, Txt } from '@/ui/components'
import { useToast } from '@/ui/Toast'
import { Glyph } from '@/ui/glyphs'
import { radius, space } from '@/ui/theme'

const OPTIONS: { value: ThemePreference; label: string; icon: 'moon' | 'sun' | 'smartphone' }[] = [
  { value: 'dark', label: 'Sombre', icon: 'moon' },
  { value: 'light', label: 'Clair', icon: 'sun' },
  { value: 'system', label: 'Système', icon: 'smartphone' },
]

function NavRow({
  href,
  icon,
  label,
  hint,
}: {
  href: '/archive' | '/trash' | '/vault'
  icon: 'archive' | 'trash-2' | 'chest'
  label: string
  hint: string
}) {
  const { theme } = useTheme()
  const router = useRouter()

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={() => router.push(href)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingHorizontal: space.md,
        minHeight: 64,
        backgroundColor: pressed ? theme.surface.raised : 'transparent',
      })}
    >
      {/* Le coffre porte le même glyphe qu'en tête de grille : deux dessins pour
          un seul endroit se lisent comme deux endroits. */}
      {icon === 'chest' ? (
        <Glyph name="chest" size={18} color={theme.text.secondary} />
      ) : (
        <Feather name={icon} size={18} color={theme.text.secondary} />
      )}
      <View style={{ flex: 1 }}>
        <Txt variant="label">{label}</Txt>
        <Txt variant="caption" tone="muted">
          {hint}
        </Txt>
      </View>
      <Feather name="chevron-right" size={18} color={theme.text.muted} />
    </Pressable>
  )
}

/**
 * Réglages du coffre, affichés seulement une fois un code défini.
 *
 * La suppression du code est irréversible dans le sens qui compte : elle ne rend
 * pas les notes masquées à la grille, elle les rend inaccessibles jusqu'à ce
 * qu'un nouveau code soit posé. C'est dit avant, pas après, et la confirmation
 * demande un second geste parce que le premier peut être un faux contact.
 */
function VaultSettings() {
  const { theme } = useTheme()
  const { biometrics, biometricsEnabled, setBiometricsEnabled, disable, confirmWithBiometrics } =
    useVault()
  const [confirming, setConfirming] = useState(false)
  const router = useRouter()
  const toast = useToast()

  /**
   * Garde les deux gestes qui désarment le coffre.
   *
   * Sans elle, le coffre avait une porte de service : n'importe qui tenant
   * l'appareil déverrouillé pouvait remplacer le code et lire ce qu'il gardait,
   * sans jamais le connaître. Le capteur ferme cette porte pour le curieux, et
   * la laisse ouverte pour le propriétaire.
   *
   * Sur un appareil sans capteur — le web en particulier — il n'y a rien à
   * demander et le geste passe. C'est assumé : refuser faute de capteur
   * enfermerait dehors quelqu'un qui a simplement oublié son code, ce qui est
   * exactement le contraire du but.
   */
  const guard = async (reason: string): Promise<boolean> => {
    const verdict = await confirmWithBiometrics(reason)
    if (verdict === 'refused') {
      toast('Identité non confirmée, le code reste en place.', { tone: 'danger' })
      return false
    }
    return true
  }

  /**
   * Efface le code puis emmène tout de suite à la saisie du nouveau.
   *
   * L'attente avant la redirection n'est pas une politesse : tant que le secret
   * n'est pas effacé, l'écran du coffre affiche encore le pavé de
   * déverrouillage. Y arriver une image trop tôt ferait clignoter l'écran qu'on
   * cherche justement à éviter, celui qui demande le code qu'on a oublié.
   */
  const replaceCode = async () => {
    if (!(await guard('Remplacer le code du coffre'))) return
    await disable()
    router.push('/vault')
  }

  const removeCode = async () => {
    if (!(await guard('Supprimer le code du coffre'))) return
    await disable()
    setConfirming(false)
  }

  return (
    <Card style={{ gap: space.md }}>
      <Txt variant="title">Coffre</Txt>
      <Seam />

      {biometrics === 'ready' ? (
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: biometricsEnabled }}
          accessibilityLabel="Ouvrir le coffre par empreinte"
          onPress={() => void setBiometricsEnabled(!biometricsEnabled)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 }}
        >
          <Feather
            name={biometricsEnabled ? 'check-square' : 'square'}
            size={18}
            color={biometricsEnabled ? theme.accent.default : theme.text.secondary}
          />
          <View style={{ flex: 1 }}>
            <Txt variant="label">Ouvrir par empreinte</Txt>
            <Txt variant="caption" tone="muted">
              Le code reste le recours si le capteur refuse.
            </Txt>
          </View>
        </Pressable>
      ) : (
        <Txt variant="caption" tone="muted">
          {biometrics === 'not-enrolled'
            ? 'Aucune empreinte enregistrée sur cet appareil.'
            : 'Cet appareil n’a pas de capteur utilisable, le coffre s’ouvre au code.'}
        </Txt>
      )}

      <Seam />

      {/**
       * Le code oublié n'est pas une impasse, mais rien ne le disait.
       *
       * Il n'est pas récupérable, et ce n'est pas un manque : l'appareil ne garde
       * qu'une empreinte SHA-256 salée, qui ne remonte pas au code. Le remplacer
       * ne coûte pourtant rien, parce que ce code ne chiffre pas les notes — il
       * les masque. Elles restent en base, gardées par RLS comme les autres, et
       * reviennent telles quelles dès qu'un nouveau code est posé.
       *
       * Le dire ici est nécessaire : le seul bouton disponible s'appelait
       * « Supprimer le code », ce que personne ne tente quand il craint de perdre
       * ce qu'il y a rangé.
       */}
      <View style={{ gap: space.xxs }}>
        <Txt variant="label">Code oublié</Txt>
        <Txt variant="caption" tone="muted">
          Il ne peut pas être retrouvé : l’appareil n’en garde qu’une empreinte, et une
          empreinte ne remonte pas à son code. Il se remplace en revanche sans rien perdre.
          Ce code masque les notes, il ne les chiffre pas : elles reviennent telles quelles
          derrière le nouveau.
        </Txt>
        <Txt variant="caption" tone="muted">
          Il est propre à cet appareil. Sur un autre, le coffre se configure à neuf et montre
          les mêmes notes.
        </Txt>
      </View>

      <Button label="Remplacer le code" onPress={() => void replaceCode()} />

      <Seam />

      {confirming ? (
        <View style={{ gap: space.sm }}>
          <Txt variant="body" tone="danger">
            Supprimer le code sans en poser un nouveau ne fait pas ressortir les
            notes masquées. Elles resteront hors de la grille, inaccessibles
            jusqu’à ce qu’un code soit défini.
          </Txt>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button
              label="Annuler"
              variant="ghost"
              style={{ flex: 1 }}
              onPress={() => setConfirming(false)}
            />
            <Button
              label="Supprimer le code"
              variant="danger"
              style={{ flex: 1 }}
              onPress={() => void removeCode()}
            />
          </View>
        </View>
      ) : (
        <Button label="Supprimer le code" variant="ghost" onPress={() => setConfirming(true)} />
      )}
    </Card>
  )
}

export default function Settings() {
  const { theme, preference, setPreference } = useTheme()
  const { session, signOut } = useAuth()
  const vault = useVault()
  const [signingOut, setSigningOut] = useState(false)

  return (
    <Screen scroll>
      <View style={{ marginTop: space.sm, marginBottom: space.md }}>
        <Inscription>Réglages</Inscription>
      </View>

      <Card style={{ gap: space.md }}>
        <View style={{ gap: space.xxs }}>
          <Txt variant="title">Apparence</Txt>
          <Txt variant="caption" tone="muted">
            Cairn démarre en sombre, quel que soit le réglage du téléphone.
          </Txt>
        </View>

        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {OPTIONS.map((option) => {
            const active = preference === option.value
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Thème ${option.label.toLowerCase()}`}
                onPress={() => setPreference(option.value)}
                style={{
                  flex: 1,
                  minHeight: 48,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: space.xxs,
                  paddingVertical: space.sm,
                  borderRadius: radius.md,
                  borderWidth: active ? 2 : 1,
                  borderColor: active ? theme.accent.default : theme.line.hairline,
                  backgroundColor: active ? theme.accent.subtle : 'transparent',
                }}
              >
                <Feather
                  name={option.icon}
                  size={16}
                  color={active ? theme.accent.default : theme.text.secondary}
                />
                <Txt variant="caption" tone={active ? 'accent' : 'secondary'}>
                  {option.label}
                </Txt>
              </Pressable>
            )
          })}
        </View>
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <NavRow
          href="/vault"
          icon="chest"
          label="Coffre"
          hint={
            vault.configured
              ? 'Notes masquées, derrière un code'
              : 'Masquer des notes derrière un code'
          }
        />
        <Seam />
        <NavRow href="/archive" icon="archive" label="Archive" hint="Notes rangées hors de la grille" />
        <Seam />
        <NavRow href="/trash" icon="trash-2" label="Corbeille" hint="Restaurer ou supprimer définitivement" />
      </Card>

      {vault.configured ? <VaultSettings /> : null}

      <Card style={{ gap: space.md }}>
        <Txt variant="title">Compte</Txt>
        <Seam />
        <View style={{ gap: space.xxs }}>
          <Txt variant="caption" tone="muted">
            Connecté en tant que
          </Txt>
          <Txt variant="body">{session?.user.email ?? 'compte sans adresse'}</Txt>
        </View>
        <Button
          label="Se déconnecter"
          variant="ghost"
          busy={signingOut}
          disabled={signingOut}
          onPress={() => {
            setSigningOut(true)
            void signOut().finally(() => setSigningOut(false))
          }}
        />
      </Card>

    </Screen>
  )
}
