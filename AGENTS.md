# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Conventions du dépôt

## Messages de commit — Conventional Commits 1.0.0

Norme : <https://www.conventionalcommits.org/en/v1.0.0/>

    <type>[portée facultative][!]: <description>

    [corps facultatif]

    [pieds de page facultatifs]

Types utilisés ici : `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`,
`ci`, `chore`, `style`, `revert`.

Règles qui comptent :

- la description est à l'impératif, en minuscule, sans point final ;
- une rupture se signale par un `!` avant le `:` **et** un pied de page
  `BREAKING CHANGE: …` ;
- le ticket se met en pied de page, pas dans la description :
  `Refs: #12` ou `Closes: #12`.

La portée nomme la zone touchée, pas le fichier : `note`, `grille`, `coffre`,
`tags`, `agenda`, `widget`, `db`, `web`, `android`.

```
feat(note): créer un tag depuis le panneau de l'éditeur

Closes: #1
```

## CHANGELOG.md — Keep a Changelog 1.1.0

Norme : <https://keepachangelog.com/en/1.1.0/>

Un journal se lit par des humains, pas par un outil : ce n'est pas `git log`
recopié. Chaque entrée dit ce qui change **pour qui se sert de Cairn**, pas quel
fichier a bougé.

- une section `## [Non publié]` en haut, où atterrissent les changements en
  cours ;
- les versions ensuite, la plus récente d'abord, au format
  `## [0.2.0] - 2026-08-08` ;
- à l'intérieur, uniquement ces titres, dans cet ordre : `### Ajouté`,
  `### Modifié`, `### Déprécié`, `### Retiré`, `### Corrigé`, `### Sécurité` ;
- une ligne par changement, terminée par le lien du ticket :
  `- Créer un tag depuis l'éditeur de note. ([#1])` ;
- les références de liens (`[#1]: https://…/issues/1`) vivent en bas du fichier ;
- les dates sont en ISO 8601, `AAAA-MM-JJ`.

**Chaque pull request met le CHANGELOG à jour dans le même commit que le code
qu'elle décrit.** Une entrée ajoutée après coup n'est plus reliée à rien.

## Pull requests

Une pull request par ticket. Le corps rappelle le ticket (`Closes #n`), ce qui
change, et comment le vérifier.

Avant d'ouvrir, `npm run verify` doit passer : typage, contrastes du thème,
logique pure, et schéma SQL joué sur du vrai Postgres.
