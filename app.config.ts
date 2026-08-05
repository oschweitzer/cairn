import type { ExpoConfig } from 'expo/config'

/**
 * Les couleurs natives viennent de generated/theme.json, lui-même dérivé de
 * src/ui/theme.ts. Aucune valeur hexadécimale n'est recopiée ici à la main :
 * l'écran de démarrage, le fond racine et l'icône adaptative suivent donc
 * automatiquement toute retouche de la palette.
 *
 * On prend la variante sombre parce que c'est le thème par défaut de Cairn,
 * indépendamment du réglage du système. Cela évite le flash blanc au lancement.
 */
const theme = require('./generated/theme.json') as {
  dark: Record<string, string>
  light: Record<string, string>
}

const dark = theme.dark

const config: ExpoConfig = {
  name: 'Cairn',
  slug: 'cairn',
  version: '0.1.0',
  orientation: 'portrait',
  scheme: 'cairn',
  icon: './assets/icon.png',

  // 'automatic' laisse le système piloter la barre d'état et le fond natif.
  // Le thème applicatif, lui, démarre en sombre et est posé au runtime par
  // src/ui/ThemeProvider.tsx via expo-system-ui.
  userInterfaceStyle: 'automatic',

  android: {
    package: 'app.cairn',
    // Fond de la fenêtre native, sous l'arbre React. Évite l'éclair blanc entre
    // la disparition de l'écran de démarrage et le premier rendu.
    backgroundColor: dark['surface-page'],
    adaptiveIcon: {
      backgroundColor: dark['surface-page'],
      foregroundImage: './assets/android-icon-foreground.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    // Le bord à bord n'est plus une option depuis le SDK 54, il est systématique.
    predictiveBackGestureEnabled: false,
  },

  web: {
    bundler: 'metro',
    // Rendu statique : nécessaire pour déployer la PWA sur Cloudflare Pages
    // et pour que chaque route existe comme fichier servi tel quel.
    output: 'static',
    favicon: './assets/favicon.png',
  },

  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-web-browser',
    // Ajoute USE_BIOMETRIC et USE_FINGERPRINT au manifeste Android, et porte le
    // texte présenté par le système au moment de la demande. Ce libellé est vu
    // par l'utilisateur : il doit dire ce qui s'ouvre, pas « authentification ».
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
}

export default config
