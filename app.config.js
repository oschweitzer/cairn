// @ts-check

/**
 * In JavaScript, and not TypeScript, for a reason outside the project.
 *
 * eas-cli bundles its own copy of the config loader, which asks for TypeScript
 * as an optional peer `^5.0.0` but ends up installed with 7.x. And TypeScript 7
 * is the Go rewrite: its main entry point only exposes `version`, the compiler
 * API having moved under `typescript/unstable/*`. So the loader reads
 * `ModuleKind.CommonJS` off an `undefined` and stops on "Cannot read properties
 * of undefined". The loader version bundled by eas-cli predates the guard that
 * handles this case, and there is no fallback: neither babel nor
 * `module.stripTypeScriptTypes`, missing before Node 22.13.
 *
 * This file is the only one in the repository that third-party tools load by
 * themselves, each with its own transpiler. Keeping it in JavaScript puts it out
 * of reach of those divergences. Typing is not lost for all that: the
 * `@ts-check` above and the annotation on `config` have this file checked by
 * `npm run typecheck` exactly as before.
 */

/**
 * The native colours come from generated/theme.json, itself derived from
 * src/ui/theme.ts. No hexadecimal value is copied here by hand: so the splash
 * screen, the root background and the adaptive icon automatically follow any
 * touch-up of the palette.
 *
 * The dark variant is taken because it is Cairn's default theme, regardless of
 * the system setting. That avoids the white flash at launch.
 *
 * @type {{ dark: Record<string, string>, light: Record<string, string> }}
 */
const theme = require('./generated/theme.json')

const dark = theme.dark

/**
 * The PWA's host, for Android app links.
 *
 * A Google Calendar event created from a note carries a
 * `https://<domain>/note/<id>` link. Declaring that host here asks Android to
 * open the link in Cairn rather than in the browser, provided the domain serves
 * a matching `/.well-known/assetlinks.json` — hence `npm run assetlinks`.
 *
 * An ordinary `https://`, and not the `cairn://` scheme: the same link has to
 * stay openable from a computer, where the app does not exist. Google also
 * requires it for the consent return, having deprecated private schemes on the
 * Android side. The `cairn://` scheme now only serves the Supabase sign-in
 * return, which has no such constraint.
 *
 * Without the variable, no filter is declared. A filter with an empty host
 * would be accepted by the build and then ignored by Android, which is very
 * hard to diagnose; declaring nothing is more honest.
 *
 * @type {string | null}
 */
const hoteWeb = (() => {
  const brut = process.env.EXPO_PUBLIC_WEB_URL?.trim()
  if (!brut) return null
  try {
    return new URL(brut).hostname
  } catch {
    throw new Error(
      `EXPO_PUBLIC_WEB_URL n'est pas une URL valide : ${brut}. Attendu par exemple https://cairn.pages.dev`,
    )
  }
})()

/** @type {import('expo/config').ExpoConfig} */
const config = {
  name: 'Cairn',
  slug: 'cairn',
  version: '0.3.0',
  orientation: 'portrait',
  scheme: 'cairn',
  icon: './assets/icon.png',

  // 'automatic' lets the system drive the status bar and the native background.
  // The app theme, for its part, starts dark and is set at runtime by
  // src/ui/ThemeProvider.tsx through expo-system-ui.
  userInterfaceStyle: 'automatic',

  android: {
    package: 'app.cairn',
    // Background of the native window, under the React tree. Avoids the white
    // flash between the splash screen disappearing and the first render.
    backgroundColor: dark['surface-page'],
    adaptiveIcon: {
      backgroundColor: dark['surface-page'],
      foregroundImage: './assets/android-icon-foreground.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    // Edge-to-edge is no longer optional since SDK 54, it is always on.
    predictiveBackGestureEnabled: false,

    /**
     * Two paths handed to the app rather than to the browser.
     *
     * `/note` carries the links left in calendar events: opening them from the
     * phone has to lead to the note, not to the PWA.
     *
     * `/google` is the Google consent's return address. It is here out of
     * necessity and not convenience: Google has deprecated private schemes on
     * the Android side, so the redirect can no longer be `cairn://`, and
     * without this filter the response would open in the browser — the app
     * would be waiting for a code that would never come back to it.
     *
     * `autoVerify` asks Android to check `/.well-known/assetlinks.json` at
     * install time. Verified, the link opens Cairn without asking anything;
     * unverified, it goes to the browser with no visible error — hence the
     * importance of `npm run assetlinks`, and the fact that the calendar
     * connection depends on it.
     */
    ...(hoteWeb
      ? {
          intentFilters: [
            {
              action: 'VIEW',
              autoVerify: true,
              data: [
                { scheme: 'https', host: hoteWeb, pathPrefix: '/note' },
                { scheme: 'https', host: hoteWeb, pathPrefix: '/google' },
              ],
              category: ['BROWSABLE', 'DEFAULT'],
            },
          ],
        }
      : {}),
  },

  web: {
    bundler: 'metro',
    // Static rendering: needed to deploy the PWA on a file host, and so every
    // route exists as a file served as is. The dynamic route is the exception,
    // hence the rewrite in netlify.toml.
    output: 'static',
    favicon: './assets/favicon.png',
  },

  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-web-browser',
    // Adds USE_BIOMETRIC and USE_FINGERPRINT to the Android manifest, and
    // carries the text the system shows when asking. The user sees this label:
    // it has to say what opens, not "authentication".
    ['expo-local-authentication', { faceIDPermission: 'Ouvrir le coffre de Cairn.' }],
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 160,
        resizeMode: 'contain',
        backgroundColor: dark['surface-page'],
        dark: { backgroundColor: dark['surface-page'] },
      },
    ],
  ],

  experiments: {
    typedRoutes: true,
  },

  // Links the folder to the EAS project, and it is what `eas build` reads to
  // know where to send the build. Set by `eas init`, which shows it as an
  // app.json — wrapped in an `expo` key. That wrapper is not copied here: the
  // object this file exports is already the Expo config, so `extra` goes at its
  // root.
  //
  // It is not a secret. The id names the project, it authorises nothing by
  // itself — the permission to build belongs to the signed-in account.
  extra: {
    eas: { projectId: '85a0f0f0-a331-47ea-a44a-348f79c6b5ac' },
  },
}

module.exports = config
