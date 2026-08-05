import { ScrollViewStyleReset } from 'expo-router/html'
import type { PropsWithChildren } from 'react'

/**
 * Document HTML de la PWA. Rendu à la compilation lors de l'export statique,
 * jamais côté client.
 *
 * Son rôle principal ici est d'éliminer le flash de thème inversé. Le bundle
 * React met plusieurs centaines de millisecondes à s'exécuter, et pendant ce
 * temps le navigateur peint le fond par défaut, soit du blanc. Un rechargement
 * en thème sombre donnerait donc un éclair blanc à chaque fois.
 *
 * Le petit script ci-dessous lit la préférence dans localStorage et pose la
 * couleur de fond avant même le premier octet de bundle. Il doit lire la même clé
 * que src/db/kv.ts, d'où l'accès direct à localStorage plutôt qu'AsyncStorage,
 * qui préfixe ses clés.
 */

const theme = require('../generated/theme.json') as {
  dark: Record<string, string>
  light: Record<string, string>
  css: string
}

const DARK_PAGE = theme.dark['surface-page']
const LIGHT_PAGE = theme.light['surface-page']

const antiFlash = `
(function () {
  try {
    var pref = localStorage.getItem('cairn.theme') || 'dark';
    var resolved = pref === 'system'
      ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : (pref === 'light' ? 'light' : 'dark');
    var root = document.documentElement;
    root.dataset.theme = resolved;
    root.style.backgroundColor = resolved === 'light' ? '${LIGHT_PAGE}' : '${DARK_PAGE}';
  } catch (e) {
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.style.backgroundColor = '${DARK_PAGE}';
  }
})();
`.trim()

const baseCss = `
html, body {
  background-color: var(--cairn-surface-page);
  margin: 0;
  padding: 0;
}
/* Le fond doit couvrir toute la fenêtre même quand le contenu est plus court,
   sinon un rebond de défilement révèle le blanc du navigateur. */
body { min-height: 100%; overscroll-behavior-y: none; }
#root { display: flex; flex-direction: column; min-height: 100%; }
`.trim()

export default function Document({ children }: PropsWithChildren) {
  return (
    <html lang="fr">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />
        <meta name="description" content="Notes et listes, réunies." />
        {/* Teinte de la barre d'adresse mobile, par thème système. */}
        <meta name="theme-color" content={DARK_PAGE} media="(prefers-color-scheme: dark)" />
        <meta name="theme-color" content={LIGHT_PAGE} media="(prefers-color-scheme: light)" />

        {/* Neutralise le défilement du body imposé par react-native-web. */}
        <ScrollViewStyleReset />

        <style dangerouslySetInnerHTML={{ __html: theme.css }} />
        <style dangerouslySetInnerHTML={{ __html: baseCss }} />
        <script dangerouslySetInnerHTML={{ __html: antiFlash }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
