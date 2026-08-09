# Widget Android

Une liste de notes sur l'écran d'accueil, avec de quoi en créer et un filtre par
tag.

## Comment ça tient debout

```
    application (JS)                       widget (processus du lanceur)
  ┌────────────────────┐                 ┌────────────────────────────┐
  │ WidgetSync         │  setSnapshot()  │ CairnWidgetProvider        │
  │  buildSnapshot()   │ ──────────────▶ │  en-tête : filtre, + , ☑   │
  └────────────────────┘   SharedPrefs   │ CairnWidgetService         │
                                         │  une ligne par note        │
                                         └────────────────────────────┘
```

Le widget **ne parle pas à Supabase**. Il est réveillé par le lanceur, sans
session et souvent sans réseau : lui confier un jeton pour qu'il essaie serait
compliqué et imprudent. L'application écrit donc un instantané à chaque fois que
la liste change, et le widget lit un fichier local. Il s'affiche instantanément,
hors ligne comme après un redémarrage du téléphone.

## Ce qui n'entre pas dans l'instantané

- la corbeille et les archives — le widget montre ce sur quoi on travaille ;
- **le coffre**, sauf réglage explicite (Réglages ▸ Widget). Et même activé,
  seul le nom de code sort : jamais le corps. L'instantané est un fichier en
  clair dans les préférences de l'application, et le coffre existe précisément
  pour que son contenu ne traîne pas là ;
- rien du tout si aucun widget n'est posé : `placedWidgetCount()` court-circuite
  l'écriture.

## Les boutons sont en haut

Le widget de Google Keep range les siens dans une colonne latérale. Sur un widget
étroit — deux cases de large, ce que la plupart des gens posent — cette colonne
mange un tiers de la largeur pour quatre pictogrammes et pousse le texte dans un
couloir. En haut, la même barre coûte une hauteur de ligne.

Elle ne défile pas : c'est une vue sœur de la `ListView`, pas sa première ligne.
Glissée dans la liste, elle partirait vers le haut au premier défilement.

## Le filtre par tag

Un appui fait tourner : tous les tags → premier tag → … → tous les tags. Le nom
du filtre en cours est écrit dans l'en-tête, sinon on ne saurait pas ce qu'on
regarde. Chaque widget posé a le sien, gardé par identifiant.

Une activité de configuration serait plus riche et beaucoup plus lourde : une
seconde `Activity`, sa mise en page, son cycle de vie, pour choisir parmi une
poignée d'étiquettes.

## Vérifier

Un widget ne se rend ni sur le web ni dans Expo Go. Il faut un build natif :

```bash
npx expo prebuild --platform android --clean
```

```bash
npx eas build --platform android --profile preview
```

Puis, sur l'appareil : appui long sur l'écran d'accueil ▸ Widgets ▸ Cairn.

`npm run theme` doit avoir tourné avant `prebuild` : le plugin recopie
`generated/colors.xml` et `generated/colors-night.xml` dans les ressources de
l'application, et échoue franchement s'ils manquent.

## Ce qui reste à faire

- La palette de tags est recopiée à la main dans `CairnWidgetService.kt` : une
  `RemoteViews` ne sait pas résoudre une ressource par un nom calculé, il lui
  faut un entier. C'est le seul endroit du projet où des couleurs échappent au
  générateur. Une teinte modifiée dans `src/ui/theme.ts` doit être reportée là.
- `profiles.widget_force_dark` n'est pas encore utilisé : le widget suit le mode
  clair ou sombre du système, via `values/` et `values-night/`.
