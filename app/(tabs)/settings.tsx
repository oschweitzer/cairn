import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { useRouter } from 'expo-router'
import Feather from '@expo/vector-icons/Feather'
import { useAuth } from '@/auth/AuthProvider'
import { useVault } from '@/vault/VaultProvider'
import { useTheme, type ThemePreference } from '@/ui/ThemeProvider'
import { Button, Card, Inscription, Screen, Seam, Txt } from '@/ui/components'
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
  icon: 'archive' | 'trash-2' | 'lock'
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
      <Feather name={icon} size={18} color={theme.text.secondary} />
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
  const { biometrics, biometricsEnabled, setBiometricsEnabled, disable } = useVault()
  const [confirming, setConfirming] = useState(false)

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

      {confirming ? (
        <View style={{ gap: space.sm }}>
          <Txt variant="body" tone="danger">
            Supprimer le code ne fait pas ressortir les notes masquées. Elles
            resteront hors de la grille, inaccessibles jusqu’à ce qu’un nouveau
            code soit défini.
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
              onPress={() => {
                void disable()
                setConfirming(false)
              }}
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
          icon="lock"
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

      <Card style={{ gap: space.sm }} recessed>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Feather name="lock" size={16} color={theme.accent.default} />
          <Txt variant="title">Coffre</Txt>
        </View>
        <Txt variant="body" tone="secondary">
          Le déverrouillage biométrique et les noms de code arrivent à la phase 3. Cette carte est
          volontairement creusée, pour montrer la surface en retrait.
        </Txt>
      </Card>
    </Screen>
  )
}
