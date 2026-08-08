# Journal des modifications

Toutes les modifications notables de Cairn sont consignées ici.

Le format suit [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
et le projet suit le [versionnage sémantique](https://semver.org/lang/fr/).

## [Non publié]

### Ajouté

- Créer un tag depuis l'éditeur de note, sous le bouton tag : il est posé sur la
  note dans la foulée, et prend la teinte la moins servie de la palette. Un nom
  déjà pris pose le tag existant au lieu de refuser. ([#1])
- Conventions du dépôt : messages de commit selon
  [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/),
  journal des modifications selon Keep a Changelog 1.1.0. Elles vivent dans
  `AGENTS.md`, que `CLAUDE.md` inclut.

### Corrigé

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
