import { ScrollViewStyleReset } from 'expo-router/html'
import type { PropsWithChildren } from 'react'

/**
 * The PWA's HTML document. Rendered at build time during the static export,
 * never on the client.
 *
 * Its main role here is to get rid of the inverted-theme flash. The React bundle
 * takes several hundred milliseconds to run, and meanwhile the browser paints
 * the default background, which is white. A reload in the dark theme would
 * therefore flash white every time.
 *
 * The small script below reads the preference from localStorage and sets the
 * background colour before the first byte of the bundle. It has to read the same
 * key as src/db/kv.ts, hence direct localStorage access rather than AsyncStorage,
 * which prefixes its keys.
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
/* The background must cover the whole window even when the content is shorter,
   otherwise a scroll bounce reveals the browser's white. */
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
        {/* Tint of the mobile address bar, per system theme. */}
        <meta name="theme-color" content={DARK_PAGE} media="(prefers-color-scheme: dark)" />
        <meta name="theme-color" content={LIGHT_PAGE} media="(prefers-color-scheme: light)" />

        {/* Neutralises the body scrolling imposed by react-native-web. */}
        <ScrollViewStyleReset />

        <style dangerouslySetInnerHTML={{ __html: theme.css }} />
        <style dangerouslySetInnerHTML={{ __html: baseCss }} />
        <script dangerouslySetInnerHTML={{ __html: antiFlash }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
