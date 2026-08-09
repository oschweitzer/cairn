# Journal des modifications

Toutes les modifications notables de Cairn sont consignées ici.

Le format suit [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
et le projet suit le [versionnage sémantique](https://semver.org/lang/fr/).

## [Non publié]

### Ajouté

- Widget Android : la liste des notes et des listes sur l'écran d'accueil, avec
  les boutons de création en haut, en barre fixe, et un filtre par tag. Toucher
  une note l'ouvre. Le widget lit une copie locale écrite par l'application, donc
  il s'affiche hors ligne et sans interroger le serveur. Les notes du coffre en
  sont exclues, sauf réglage explicite — et même alors, seul le nom de code sort.
  ([#6])
- Réglages ▸ Widget, pour ce dernier réglage. ([#6])
- Réordonner les notes de l'écran d'accueil par glisser-déposer, à la poignée en
  haut à gauche de chaque carte. Les épinglées restent en tête : une note
  ordinaire déposée parmi elles se pose juste après. L'ordre est enregistré et
  suit les appareils, une note modifiée ne remonte plus, une note créée arrive en
  tête. La poignée disparaît en mode sélection et sous un filtre, où l'ordre
  d'une vue partielle ne voudrait rien dire. ([#5])
- Mise en forme du texte des notes et des listes : gras, italique, souligné,
  barré, grand titre, sous-titre et liste à puces, par une barre de commandes
  sous le bouton **B** de l'éditeur. Le balisage voyage dans le texte
  (`**gras**`, `# titre`, `- puce`), donc rien ne change ni pour le coffre, ni
  pour la recherche, ni pour l'export vers l'agenda. ([#3])
- Les liens sont cliquables. Une URL écrite au fil du texte est reconnue sans
  balisage — les notes déjà écrites deviennent donc cliquables sans rien y
  toucher — et `[libellé](adresse)` pose un lien nommé. Un bouton bascule
  l'éditeur entre écriture et lecture ; c'est en lecture que les liens s'ouvrent
  et que la mise en forme se voit. ([#3])
- Créer un tag depuis l'éditeur de note, sous le bouton tag : il est posé sur la
  note dans la foulée, et prend la teinte la moins servie de la palette. Un nom
  déjà pris pose le tag existant au lieu de refuser. ([#1])
- Conventions du dépôt : messages de commit selon
  [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/),
  journal des modifications selon Keep a Changelog 1.1.0. Elles vivent dans
  `AGENTS.md`, que `CLAUDE.md` inclut.

### Modifié

- L'application Android embarque désormais du code natif à elle, pour le widget.
  Elle ne se lance donc plus dans Expo Go : `npm run android` construit une
  version de développement (`expo run:android`). Le web et la PWA ne changent
  pas. ([#6])

### Corrigé

- Changer le tag d'une note qui en portait déjà un fonctionne. L'ancien
  revenait : les tags étaient remplacés en bloc par une suppression suivie d'une
  réinsertion, et deux gestes rapprochés s'entrelaçaient. Ils sont désormais
  posés et retirés un par un, ce qui les rend indépendants. La couleur héritée
  suit le changement au lieu de rester sur celle de l'ancienne catégorie ; une
  couleur choisie à la main n'est toujours pas touchée. ([#4])
- Éditeur de note : le champ de contenu occupe la hauteur disponible sous le
  titre au lieu de s'arrêter à 220 points. La grande zone morte qui le suivait —
  les deux tiers de l'écran sur un poste de bureau — était cliquable sans rien
  faire ; elle fait maintenant partie du champ. Aucune barre de défilement tant
  que le texte tient dans la place offerte. ([#2])

## [0.1.0] - 2026-08-08

Première version, avant la mise en place de ce journal. Les entrées ci-dessous
résument les quatre commits initiaux ; elles sont reconstituées, pas rédigées
au fil de l'eau.

### Ajouté

- Notes et listes multiplateformes : grille en maçonnerie, épinglage, archive,
  corbeille, tags colorés, recherche hors ligne, thème clair et sombre.
- Coffre chiffré de bout en bout : une clé de données par personne, scellée par
  une clé de secours affichée une seule fois, verrouillage par code ou biométrie.
- Infobulles sur toutes les commandes d'icône.
- Récupération de mot de passe et suppression de compte.
- Export d'une note vers Google Agenda, construction d'APK, et configuration
  Expo en JavaScript.

[Non publié]: https://github.com/oschweitzer/cairn/compare/f630263...HEAD
[#1]: https://github.com/oschweitzer/cairn/issues/1
[#2]: https://github.com/oschweitzer/cairn/issues/2
[#3]: https://github.com/oschweitzer/cairn/issues/3
[#4]: https://github.com/oschweitzer/cairn/issues/4
[#5]: https://github.com/oschweitzer/cairn/issues/5
[#6]: https://github.com/oschweitzer/cairn/issues/6
