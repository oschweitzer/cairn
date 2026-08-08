import { useEffect } from 'react'
import { View } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { Logotype, Screen, Txt } from '@/ui/components'
import { space } from '@/ui/theme'

/**
 * Retour du consentement Google Agenda, sur le web.
 *
 * Cette page n'existe que pour être chargée puis se refermer, et elle n'est pas
 * facultative. Sur le web, `promptAsync` ouvre une fenêtre surgissante et
 * attend : c'est la page d'atterrissage qui doit rendre la main, en appelant
 * `maybeCompleteAuthSession`, laquelle poste l'URL complète — code
 * d'autorisation compris — à la fenêtre qui l'a ouverte, puis la ferme. Sans
 * cet appel, la fenêtre reste ouverte sur une page morte et la connexion
 * n'aboutit jamais.
 *
 * Sur Android, rien de tout cela ne sert : `openAuthSessionAsync` intercepte
 * lui-même la redirection `cairn://google` et rend le résultat à l'appelant,
 * sans qu'aucune route ne soit atteinte. La page ne coûte rien pour autant, et
 * l'avoir des deux côtés évite d'avoir à se rappeler laquelle des deux
 * plateformes en a besoin.
 *
 * Dans le groupe (auth) pour la même raison que `callback.tsx` : l'aiguillage
 * du layout racine renvoie vers la connexion tout utilisateur sans session
 * rencontré hors de ce groupe. La fenêtre surgissante est un contexte neuf, où
 * la session peut n'être pas encore relue ; ailleurs, cette page rebondirait
 * vers /sign-in avant d'avoir rendu la main, en emportant le code.
 */
export default function GoogleCallback() {
  useEffect(() => {
    // L'échec n'a pas à être traité ici : il signifie qu'aucune autorisation
    // n'est en cours, c'est-à-dire que quelqu'un a ouvert cette adresse
    // directement. Le texte ci-dessous suffit alors.
    void WebBrowser.maybeCompleteAuthSession()
  }, [])

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', gap: space.md }}>
        <Logotype />
        <Txt variant="body" tone="muted">
          Autorisation en cours, cette fenêtre va se refermer.
        </Txt>
      </View>
    </Screen>
  )
}
