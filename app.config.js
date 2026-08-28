// @ts-check

/**
 * En JavaScript, et pas en TypeScript, pour une raison extérieure au projet.
 *
 * eas-cli embarque sa propre copie du chargeur de configuration, laquelle
 * réclame TypeScript en pair optionnel `^5.0.0` mais se retrouve installée avec
 * la 7.x. Or TypeScript 7 est la réécriture en Go : son entrée principale
 * n'expose plus que `version`, l'API du compilateur ayant migré sous
 * `typescript/unstable/*`. Le chargeur y lit donc `ModuleKind.CommonJS` sur un
 * `undefined` et s'arrête sur « Cannot read properties of undefined ». La
 * version du chargeur qu'embarque eas-cli est antérieure au garde-fou qui
 * neutralise ce cas, et il n'existe aucun repli : ni babel, ni
 * `module.stripTypeScriptTypes`, absent avant Node 22.13.
 *
 * Ce fichier est le seul du dépôt que des outils tiers chargent par eux-mêmes,
 * chacun avec son propre transpileur. Le garder en JavaScript le met hors
 * d'atteinte de ces divergences. Le typage n'est pas perdu pour autant : le
 * `@ts-check` ci-dessus et l'annotation portée sur `config` font vérifier ce
 * fichier par `npm run typecheck` exactement comme avant.
 */

/**
 * Les couleurs natives viennent de generated/theme.json, lui-même dérivé de
 * src/ui/theme.ts. Aucune valeur hexadécimale n'est recopiée ici à la main :
 * l'écran de démarrage, le fond racine et l'icône adaptative suivent donc
 * automatiquement toute retouche de la palette.
 *
 * On prend la variante sombre parce que c'est le thème par défaut de Cairn,
 * indépendamment du réglage du système. Cela évite le flash blanc au lancement.
 *
 * @type {{ dark: Record<string, string>, light: Record<string, string> }}
 */
const theme = require('./generated/theme.json')

const dark = theme.dark

/**
 * Hôte de la PWA, pour les liens d'application Android.
 *
 * Un évènement Google Agenda créé depuis une note porte un lien
 * `https://<domaine>/note/<id>`. Déclarer cet hôte ici demande à Android
 * d'ouvrir ce lien dans Cairn plutôt que dans le navigateur, à condition que le
 * domaine serve un `/.well-known/assetlinks.json` concordant — d'où
 * `npm run assetlinks`.
 *
 * Un `https://` ordinaire, et non le schéma `cairn://` : le même lien doit
 * rester ouvrable depuis un ordinateur, où l'application n'existe pas. Google
 * l'impose de surcroît pour le retour de consentement, ayant déprécié les
 * schémas privés côté Android. Le schéma `cairn://` ne sert plus qu'au retour
 * de connexion Supabase, qui n'a pas cette contrainte.
 *
 * Sans variable, aucun filtre n'est déclaré. Un filtre portant un hôte vide
 * serait accepté par le build puis ignoré par Android, ce qui se diagnostique
 * très mal ; ne rien déclarer est plus honnête.
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
  version: '0.2.1',
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

    /**
     * Deux chemins remis à l'application plutôt qu'au navigateur.
     *
     * `/note` porte les liens déposés dans les évènements d'agenda : les
     * ouvrir depuis le téléphone doit mener à la note, pas à la PWA.
     *
     * `/google` est l'adresse de retour du consentement Google. Elle est ici
     * par nécessité et non par confort : Google a déprécié les schémas privés
     * côté Android, la redirection ne peut donc plus être `cairn://`, et sans
     * ce filtre la réponse s'ouvrirait dans le navigateur — l'application
     * attendrait un code qui ne lui reviendrait jamais.
     *
     * `autoVerify` demande à Android de vérifier `/.well-known/assetlinks.json`
     * à l'installation. Vérifié, le lien ouvre Cairn sans rien demander ; non
     * vérifié, il part au navigateur sans erreur visible — d'où l'importance de
     * `npm run assetlinks`, et le fait que la connexion à l'agenda en dépend.
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
    // Rendu statique : nécessaire pour déployer la PWA sur un hébergeur de
    // fichiers, et pour que chaque route existe comme fichier servi tel quel.
    // La route dynamique fait exception, d'où la réécriture de netlify.toml.
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

  // Rattache le dossier au projet EAS, et c'est lui que lit `eas build` pour
  // savoir où envoyer la construction. Posé par `eas init`, qui l'affiche sous
  // la forme d'un app.json — enveloppé dans une clé `expo`. Cette enveloppe ne
  // se recopie pas ici : l'objet exporté par ce fichier est déjà la
  // configuration Expo, `extra` se pose donc à sa racine.
  //
  // Ce n'est pas un secret. L'identifiant désigne le projet, il n'autorise
  // rien par lui-même — la permission de construire tient au compte connecté.
  extra: {
    eas: { projectId: '85a0f0f0-a331-47ea-a44a-348f79c6b5ac' },
  },
}

module.exports = config
