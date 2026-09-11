import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { useRouter } from 'expo-router'
import Feather from '@expo/vector-icons/Feather'
import { useAuth } from '@/auth/AuthProvider'
import { useVault } from '@/vault/VaultProvider'
import { useTheme, type ThemePreference } from '@/ui/ThemeProvider'
import { Button, Card, Field, Inscription, Screen, Seam, Txt } from '@/ui/components'
import { useToast } from '@/ui/Toast'
import { Glyph } from '@/ui/glyphs'
import { radius, space } from '@/ui/theme'
import {
  agendaConfigure,
  agendaUtilisable,
  useCompteGoogle,
  useConnecterAgenda,
  useDeconnecterAgenda,
} from '@/google/agenda'
import { useProfile, useUpdateProfile } from '@/db/queries'
import { widgetAvailable } from '../../modules/cairn-widget'

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
      {/* The vault carries the same glyph as at the top of the grid: two
          drawings for a single place read as two places. */}
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
 * Vault settings, shown only once a code has been set.
 *
 * Removing the code is irreversible in the sense that matters: it does not give
 * the hidden notes back to the grid, it makes them unreachable until a new code
 * is set. That is said before, not after, and confirming takes a second gesture
 * because the first may be an accidental touch.
 */
function VaultSettings() {
  const { theme } = useTheme()
  const { biometrics, biometricsEnabled, setBiometricsEnabled, disable, confirmWithBiometrics } =
    useVault()
  const [confirming, setConfirming] = useState(false)
  const router = useRouter()
  const toast = useToast()

  /**
   * Guards the two gestures that disarm the vault.
   *
   * Without it, the vault had a back door: anyone holding the unlocked device
   * could replace the code and read what it kept, without ever knowing it. The
   * sensor shuts that door on the curious, and leaves it open for the owner.
   *
   * On a device without a sensor — the web in particular — there is nothing to
   * ask and the gesture goes through. That is deliberate: refusing for lack of a
   * sensor would lock out someone who has simply forgotten their code, which is
   * exactly the opposite of the goal.
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
   * Erases the code then goes straight to entering the new one.
   *
   * Waiting before the redirect is not a courtesy: as long as the secret has
   * not been erased, the vault screen still shows the unlock keypad. Arriving
   * one frame too early would flash the very screen we are trying to avoid, the
   * one asking for the code that was forgotten.
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
       * A forgotten code is not a dead end, but nothing said so.
       *
       * It cannot be recovered, and that is not a gap: the device only keeps a
       * salted SHA-256 hash, which does not lead back to the code. Replacing it
       * costs nothing though, because this code does not encrypt the notes — it
       * hides them. They stay in the database, guarded by RLS like the others,
       * and come back as they were as soon as a new code is set.
       *
       * Saying it here is necessary: the only available button was called
       * « Supprimer le code », which nobody tries when they fear losing what
       * they filed there.
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

/**
 * Account deletion.
 *
 * ── Why copy out your address, and not a plain "Confirm" ─────────────────────
 * A second button proves nothing: it is clicked with the same gesture as the
 * first, and that is exactly what happens when you go through settings without
 * reading. Copying the address out takes reading it, so knowing which account
 * disappears — which really matters when you have several. It is also the only
 * barrier available here: asking for the password again is not possible for a
 * Google account, and the vault code says nothing about the account.
 *
 * ── The order of the two erasures is a choice, not a convenience ─────────────
 * The server first, the device second. If the network call fails, the data key
 * is still there and the account stays usable. The other way round, a failure
 * would leave a very much alive account whose encrypted notes had become
 * unreadable — the worst of the two outcomes, and with no way back.
 */
function DeleteAccount() {
  const { session, deleteAccount } = useAuth()
  const vault = useVault()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const email = session?.user.email ?? ''
  // A lenient comparison on case and spaces: the barrier is knowing which
  // address, not typing it to the exact character.
  const matches = email !== '' && typed.trim().toLowerCase() === email.toLowerCase()

  async function remove() {
    setError(null)
    setBusy(true)
    try {
      await deleteAccount()
      // Only once the server has agreed: see the header.
      await vault.forgetEverything()
      // Nothing to do afterwards. The session drops, and the root routing
      // brings you back to the sign-in screen.
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <>
        <Seam />
        <Button
          label="Supprimer le compte"
          variant="ghost"
          onPress={() => {
            setTyped('')
            setError(null)
            setOpen(true)
          }}
        />
      </>
    )
  }

  return (
    <>
      <Seam />
      <View style={{ gap: space.sm }}>
        <Txt variant="body" tone="danger">
          Tout est effacé, et rien n’est récupérable.
        </Txt>
        <Txt variant="caption" tone="muted">
          Les notes et les listes, y compris celles du coffre et celles de la corbeille, les
          tags, les rappels, et le compte lui-même. La suppression est immédiate : il n’y a
          pas de délai pendant lequel revenir en arrière.
        </Txt>
        {/* `configured` and not `keyStatus`: the latter is "checking" as long as
            the vault has not been opened during the session, including for
            someone who never had one. So the sentence showed to people without
            a vault, telling them about a recovery key that does not exist. Seen
            on screen, not in the code. */}
        {vault.configured ? (
          <Txt variant="caption" tone="muted">
            La clé de secours du coffre cessera de servir à quoi que ce soit : ce qu’elle
            ouvrait n’existera plus.
          </Txt>
        ) : null}
        <Txt variant="caption" tone="muted">
          Pour continuer, recopie l’adresse du compte.
        </Txt>

        {/* The address is a hint under the field rather than its label: a label
            that changes from one account to another no longer says what the
            field expects, and that is precisely what has to be understood here. */}
        <Field
          label="Recopier l’adresse"
          hint={email}
          value={typed}
          onChangeText={setTyped}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          accessibilityLabel="Recopier l’adresse du compte pour confirmer la suppression"
          editable={!busy}
        />

        {error ? (
          <Txt variant="caption" tone="danger">
            {error}
          </Txt>
        ) : null}

        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button
            label="Annuler"
            variant="ghost"
            style={{ flex: 1 }}
            disabled={busy}
            onPress={() => setOpen(false)}
          />
          <Button
            label="Supprimer définitivement"
            variant="danger"
            style={{ flex: 1 }}
            busy={busy}
            disabled={!matches || busy}
            onPress={() => void remove()}
          />
        </View>
      </View>
    </>
  )
}

/**
 * Google Calendar connection.
 *
 * Kept apart from the Account section, and it is not just a matter of tidiness:
 * signing in to Cairn and the permission to write to the calendar are two
 * separate consents, one of which can be withdrawn without the other. Showing
 * them together would suggest that signing out of Cairn revokes calendar
 * access, or the reverse.
 *
 * The card does not appear when the installation is not configured for it:
 * offering a connection that will fail on the first click teaches nobody
 * anything.
 */
/**
 * Android widget settings.
 *
 * Absent anywhere but Android: on the web and on a device without a widget
 * placed, a settings card for something that does not exist is noise. The
 * setting itself stays in the database and follows the account — it is a
 * phone's widget, but the choice is a person's.
 */
function WidgetSettings() {
  const { theme } = useTheme()
  const profileQuery = useProfile()
  const updateProfile = useUpdateProfile()

  if (!widgetAvailable) return null

  const profile = profileQuery.data
  const showPrivate = profile?.widget_show_private ?? false

  return (
    <Card style={{ gap: space.md }}>
      <View style={{ gap: space.xxs }}>
        <Txt variant="title">Widget</Txt>
        <Txt variant="caption" tone="muted">
          Le widget lit une copie locale des notes, écrite par l’application. Il
          s’affiche donc hors ligne, et sans jamais interroger le serveur.
        </Txt>
      </View>
      <Seam />

      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: showPrivate, disabled: !profile }}
        accessibilityLabel="Montrer les notes du coffre dans le widget"
        disabled={!profile}
        onPress={() =>
          profile &&
          updateProfile.mutate({
            id: profile.id,
            patch: { widget_show_private: !showPrivate },
          })
        }
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          minHeight: 48,
          opacity: profile ? 1 : 0.5,
        }}
      >
        <Feather
          name={showPrivate ? 'check-square' : 'square'}
          size={18}
          color={showPrivate ? theme.accent.default : theme.text.secondary}
        />
        <View style={{ flex: 1 }}>
          <Txt variant="label">Montrer les notes du coffre</Txt>
          <Txt variant="caption" tone="muted">
            {showPrivate
              ? 'Seul le nom de code s’affiche. Le contenu ne sort jamais du coffre.'
              : 'Le widget ignore le coffre, y compris les noms de code.'}
          </Txt>
        </View>
      </Pressable>
    </Card>
  )
}

function AgendaSettings() {
  const toast = useToast()
  const compte = useCompteGoogle()
  const connecter = useConnecterAgenda()
  const deconnecter = useDeconnecterAgenda()

  if (!agendaConfigure) return null

  const connecte = agendaUtilisable(compte.data)
  const expire = compte.data?.refresh_expires_at

  return (
    <Card style={{ gap: space.md }}>
      <Txt variant="title">Agenda Google</Txt>
      <Seam />

      {connecte ? (
        <>
          <View style={{ gap: space.xxs }}>
            <Txt variant="caption" tone="muted">
              Autorisé sur le compte
            </Txt>
            <Txt variant="body">{compte.data?.google_email ?? 'compte Google'}</Txt>
          </View>

          {/* The expiry is stated as long as it exists, not only once it has
              passed: in Google's test mode it falls every seven days, and
              learning it at the moment of sending a note is too late. */}
          {expire ? (
            <Txt variant="caption" tone="muted">
              Autorisation valable jusqu’au{' '}
              {new Date(expire).toLocaleDateString('fr-FR', {
                day: 'numeric',
                month: 'long',
              })}
              . Google la coupe tous les sept jours tant que le projet est en mode test.
            </Txt>
          ) : null}

          <Button
            label="Retirer l’accès à l’agenda"
            variant="ghost"
            busy={deconnecter.isPending}
            onPress={() => {
              deconnecter.mutate(undefined, {
                onSuccess: () => toast('Accès à l’agenda retiré.', { tone: 'success' }),
                onError: (e) => toast((e as Error).message, { tone: 'danger' }),
              })
            }}
          />
        </>
      ) : (
        <>
          <Txt variant="caption" tone="muted">
            {compte.data?.needs_reauth
              ? 'L’autorisation a expiré. Une note ne peut plus partir vers l’agenda tant qu’elle n’est pas renouvelée.'
              : 'Permet d’ajouter une note à ton agenda, depuis l’écran de la note. Seuls le titre et un lien sont envoyés — jamais le contenu.'}
          </Txt>
          <Button
            label={compte.data?.needs_reauth ? 'Réautoriser l’agenda' : 'Autoriser l’agenda'}
            busy={connecter.isPending}
            onPress={() => {
              connecter.mutate(undefined, {
                onSuccess: (r) => {
                  if (!r.annule) toast('Agenda connecté.', { tone: 'success' })
                },
                onError: (e) => toast((e as Error).message, { tone: 'danger' }),
              })
            }}
          />
        </>
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

      <WidgetSettings />

      <AgendaSettings />

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

        <DeleteAccount />
      </Card>

    </Screen>
  )
}
