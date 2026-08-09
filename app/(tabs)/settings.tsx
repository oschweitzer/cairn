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

/**
 * Suppression du compte.
 *
 * ── Pourquoi recopier son adresse, et pas un simple « Confirmer » ────────────
 * Un second bouton ne prouve rien : il se clique du même geste que le premier,
 * et c'est exactement ce qui arrive quand on parcourt des réglages sans lire.
 * Recopier l'adresse demande de la lire, donc de savoir quel compte disparaît —
 * ce qui compte pour de bon quand on en a plusieurs. C'est aussi la seule barrière
 * disponible ici : redemander le mot de passe n'est pas possible pour un compte
 * Google, et le code du coffre ne dit rien du compte.
 *
 * ── L'ordre des deux effacements est un choix, pas une commodité ─────────────
 * Le serveur d'abord, l'appareil ensuite. Si l'appel réseau échoue, la clé de
 * données est encore là et le compte reste utilisable. Dans l'autre sens, un
 * échec laisserait un compte bien vivant dont les notes chiffrées seraient
 * devenues illisibles — le pire des deux résultats, et sans retour possible.
 */
function DeleteAccount() {
  const { session, deleteAccount } = useAuth()
  const vault = useVault()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const email = session?.user.email ?? ''
  // Comparaison indulgente sur la casse et les espaces : la barrière est de
  // savoir quelle adresse, pas de la taper au caractère près.
  const matches = email !== '' && typed.trim().toLowerCase() === email.toLowerCase()

  async function remove() {
    setError(null)
    setBusy(true)
    try {
      await deleteAccount()
      // Seulement une fois le serveur d'accord : voir l'en-tête.
      await vault.forgetEverything()
      // Rien à faire ensuite. La session tombe, l'aiguillage de la racine
      // ramène à l'écran de connexion.
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
        {/* `configured` et non `keyStatus` : ce dernier vaut « checking » tant que
            le coffre n'a pas été ouvert dans la séance, y compris chez quelqu'un
            qui n'en a jamais eu. La phrase s'affichait donc à des gens sans
            coffre, pour leur parler d'une clé de secours qui n'existe pas. Vu à
            l'écran, pas dans le code. */}
        {vault.configured ? (
          <Txt variant="caption" tone="muted">
            La clé de secours du coffre cessera de servir à quoi que ce soit : ce qu’elle
            ouvrait n’existera plus.
          </Txt>
        ) : null}
        <Txt variant="caption" tone="muted">
          Pour continuer, recopie l’adresse du compte.
        </Txt>

        {/* L'adresse est en repère sous le champ plutôt qu'en étiquette : une
            étiquette qui change d'un compte à l'autre ne dit plus ce que le
            champ attend, et c'est justement ce qu'il faut comprendre ici. */}
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
 * Connexion à Google Agenda.
 *
 * Séparée de la section Compte, et ce n'est pas qu'une question de rangement :
 * la connexion à Cairn et l'autorisation d'écrire dans l'agenda sont deux
 * consentements distincts, l'un pouvant se retirer sans l'autre. Les afficher
 * ensemble laisserait croire que se déconnecter de Cairn révoque l'accès à
 * l'agenda, ou l'inverse.
 *
 * La carte n'apparaît pas quand l'installation n'est pas configurée pour :
 * proposer une connexion qui échouera au premier clic n'apprend rien à
 * personne.
 */
/**
 * Réglages du widget Android.
 *
 * Absente ailleurs qu'Android : sur le web et sur un appareil sans widget posé,
 * une carte de réglages pour quelque chose qui n'existe pas est du bruit. Le
 * réglage lui-même reste en base et suit le compte — c'est le widget d'un
 * téléphone, mais le choix est celui d'une personne.
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

          {/* L'échéance est dite tant qu'elle existe, pas seulement une fois
              dépassée : en mode test Google elle tombe tous les sept jours, et
              l'apprendre au moment d'envoyer une note est trop tard. */}
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
