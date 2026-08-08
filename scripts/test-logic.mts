/**
 * Tests de la logique pure de src/db/noteLogic.ts.
 *
 *   npm run test:logic
 *
 * Ces fonctions n'ont besoin ni de React ni du réseau, donc elles se testent
 * directement. C'est ce qui reste vérifiable sans projet Supabase, et c'est aussi
 * là que se cachent les bugs qui comptent : une note qui disparaît d'une liste, un
 * accent qui casse une recherche, une colonne qui reçoit tout.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  byPinThenRecent,
  colorAfterTagChange,
  columnsForWidth,
  composeNotes,
  displayTitle,
  distributeIntoColumns,
  filterNotes,
  findTagNamed,
  fold,
  hasAllTags,
  inheritedColor,
  isEmptyNote,
  matchesSearch,
  nextTagColor,
  type NoteWithRelations,
} from '../src/db/noteLogic'
import type { Note, PlainChecklistItem, Tag } from '../src/db/types'
import { delayForFailures, judgePin, FREE_ATTEMPTS } from '../src/vault/policy'
import { countInRange, splitHash } from '../src/auth/pwnedLogic'
import {
  decalerJours,
  formaterDate,
  lireCreneau,
  prochainCreneau,
} from '../src/google/creneau'
import { randomBytes as nodeRandomBytes } from 'node:crypto'
import {
  createDataKey,
  createRecoveryKey,
  formatRecoveryKey,
  openText,
  parseRecoveryKey,
  sealText,
  unwrapDataKey,
  wrapDataKey,
} from '../src/vault/crypto'

// ------------------------------------------------------------- fabriques

function note(over: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    user_id: 'u1',
    kind: 'note',
    title: null,
    body: null,
    color_key: null,
    is_pinned: false,
    is_archived: false,
    is_private: false,
    code_name: null,
    is_encrypted: false,
    ciphertext: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
    ...over,
  }
}

function item(over: Partial<PlainChecklistItem> = {}): PlainChecklistItem {
  return {
    id: 'i1',
    note_id: 'n1',
    user_id: 'u1',
    content: 'élément',
    is_encrypted: false,
    ciphertext: null,
    is_done: false,
    position: 0,
    due_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  }
}

function tag(over: Partial<Tag> = {}): Tag {
  return {
    id: 't1',
    user_id: 'u1',
    name: 'maison',
    color_key: 'ambre',
    position: 0,
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  }
}

const composed = (over: Partial<NoteWithRelations> = {}): NoteWithRelations => ({
  ...note(),
  items: [],
  tags: [],
  ...over,
})

// ------------------------------------------------------------ composition

test('composeNotes rattache les éléments à leur note et les trie par position', () => {
  const result = composeNotes(
    [note({ id: 'a' }), note({ id: 'b' })],
    [
      item({ id: 'i3', note_id: 'a', content: 'Café', position: 2 }),
      item({ id: 'i1', note_id: 'a', content: 'Pain', position: 0 }),
      item({ id: 'i2', note_id: 'b', content: 'Autre', position: 0 }),
    ],
    [],
    [],
  )
  assert.deepEqual(
    result.find((n) => n.id === 'a')!.items.map((i) => i.content),
    ['Pain', 'Café'],
  )
  assert.equal(result.find((n) => n.id === 'b')!.items.length, 1)
})

test('composeNotes ignore un lien vers un tag absent du cache', () => {
  // Cas réel : le tag vient d'être supprimé mais la liste de liens est en retard.
  const result = composeNotes(
    [note({ id: 'a' })],
    [],
    [
      { note_id: 'a', tag_id: 'existe' },
      { note_id: 'a', tag_id: 'supprime' },
    ],
    [tag({ id: 'existe', name: 'maison' })],
  )
  assert.equal(result[0].tags.length, 1)
  assert.equal(result[0].tags[0].name, 'maison')
})

test('composeNotes laisse une note sans relations avec des tableaux vides', () => {
  const result = composeNotes([note({ id: 'seule' })], [], [], [])
  assert.deepEqual(result[0].items, [])
  assert.deepEqual(result[0].tags, [])
})

// -------------------------------------------------------------------- tri

test('byPinThenRecent place les épinglées devant, puis les plus récentes', () => {
  const list = [
    note({ id: 'vieille', updated_at: '2026-01-01T00:00:00Z' }),
    note({ id: 'epinglee', is_pinned: true, updated_at: '2025-01-01T00:00:00Z' }),
    note({ id: 'recente', updated_at: '2026-06-01T00:00:00Z' }),
  ]
  assert.deepEqual([...list].sort(byPinThenRecent).map((n) => n.id), [
    'epinglee',
    'recente',
    'vieille',
  ])
})

// -------------------------------------------------------------- recherche

test('fold retire les accents et met en minuscules', () => {
  assert.equal(fold('Café ÉCOLE Août'), 'cafe ecole aout')
})

test('la recherche sans accent trouve un contenu accentué', () => {
  const n = composed({ title: 'Réunion à l’école' })
  assert.equal(matchesSearch(n, fold('ecole')), true)
  assert.equal(matchesSearch(n, fold('reunion')), true)
})

test('la recherche accentuée trouve aussi un contenu sans accent', () => {
  const n = composed({ title: 'Reunion' })
  assert.equal(matchesSearch(n, fold('réunion')), true)
})

test('la recherche porte sur les éléments de liste et sur les noms de tags', () => {
  const n = composed({
    title: 'Courses',
    items: [item({ content: 'Lait' })],
    tags: [tag({ name: 'quotidien' })],
  })
  assert.equal(matchesSearch(n, fold('lait')), true)
  assert.equal(matchesSearch(n, fold('quotidien')), true)
  assert.equal(matchesSearch(n, fold('inexistant')), false)
})

test('une recherche vide ne filtre rien', () => {
  assert.equal(matchesSearch(composed(), fold('')), true)
})

test('la recherche couvre le nom de code, pas seulement le titre', () => {
  // Une note du coffre n'a pas de titre, seulement un nom de code.
  const n = composed({ title: null, is_private: true, code_name: 'Basalte' })
  assert.equal(matchesSearch(n, fold('basalte')), true)
})

// -------------------------------------------------------- couleur héritée

test('une note sans couleur prend celle du tag qu’on vient de lui poser', () => {
  assert.equal(inheritedColor(note({ color_key: null }), tag({ color_key: 'fjord' })), 'fjord')
})

test('une note déjà colorée garde sa couleur quand on la tague', () => {
  assert.equal(inheritedColor(note({ color_key: 'braise' }), tag({ color_key: 'fjord' })), null)
})

test('retirer un tag ne touche pas à la couleur', () => {
  // Pas de tag ajouté : rien à hériter, quel que soit l'état de la note.
  assert.equal(inheritedColor(note({ color_key: null }), undefined), null)
  assert.equal(inheritedColor(note({ color_key: 'lichen' }), undefined), null)
})

test('le second tag n’écrase pas la couleur héritée du premier', () => {
  // La note a hérité de « fjord » au premier tag : elle est colorée, donc le
  // suivant ne la repeint pas. Sans quoi la carte changerait de teinte à chaque
  // tag ajouté, sans que rien ne l'explique.
  const afterFirst = note({ color_key: inheritedColor(note(), tag({ color_key: 'fjord' })) })
  assert.equal(inheritedColor(afterFirst, tag({ id: 't2', color_key: 'airelle' })), null)
})

// ------------------------------------------- couleur après changement de tags

/** Raccourci : `undefined` veut dire « ne rien écrire », `null` « effacer ». */
const maison = tag({ id: 'a', color_key: 'ambre' })
const sentier = tag({ id: 'b', color_key: 'fjord' })

test('poser un tag sur une note sans couleur la teinte', () => {
  assert.equal(colorAfterTagChange(note({ color_key: null }), [], [maison]), 'ambre')
})

test('poser un tag de plus ne repeint pas une note déjà colorée', () => {
  // Le premier tag a donné sa teinte, le second ne la reprend pas : la carte
  // changerait de couleur à chaque tag ajouté sans que rien ne l'explique.
  const n = note({ color_key: 'ambre' })
  assert.equal(colorAfterTagChange(n, [maison], [maison, sentier]), undefined)
})

test('changer de tag emmène la couleur avec lui', () => {
  // Le cas du ticket : la note gardait la teinte de l'ancienne catégorie, et le
  // changement se lisait comme n'ayant pas pris.
  const n = note({ color_key: 'ambre' })
  assert.equal(colorAfterTagChange(n, [maison], [sentier]), 'fjord')
})

test('retirer le tag dont la note tenait sa couleur la relâche', () => {
  const n = note({ color_key: 'ambre' })
  assert.equal(colorAfterTagChange(n, [maison], []), null)
})

test('une couleur choisie à la main survit au retrait d’un tag', () => {
  // « braise » n'est la teinte d'aucun tag porté : elle vient de la main de
  // l'utilisateur, et rien ne justifie de la reprendre.
  const n = note({ color_key: 'braise' })
  assert.equal(colorAfterTagChange(n, [maison], []), undefined)
  assert.equal(colorAfterTagChange(n, [maison], [sentier]), undefined)
})

test('la couleur reste si un tag restant la porte encore', () => {
  // Deux tags de la même teinte : en retirer un ne rend pas la couleur
  // orpheline, l'autre la porte toujours.
  const jumeau = tag({ id: 'c', color_key: 'ambre' })
  const n = note({ color_key: 'ambre' })
  assert.equal(colorAfterTagChange(n, [maison, jumeau], [jumeau]), undefined)
})

test('un geste qui ne change rien n’écrit rien', () => {
  const n = note({ color_key: 'ambre' })
  assert.equal(colorAfterTagChange(n, [maison], [maison]), undefined)
  assert.equal(colorAfterTagChange(note({ color_key: null }), [], []), undefined)
})

// ------------------------------------------------- création de tag à la volée

test('un tag existant est reconnu malgré la casse et les accents', () => {
  const tags = [tag({ id: 'a', name: 'École' }), tag({ id: 'b', name: 'maison' })]
  assert.equal(findTagNamed(tags, 'ecole')?.id, 'a')
  assert.equal(findTagNamed(tags, '  MAISON  ')?.id, 'b')
  assert.equal(findTagNamed(tags, 'courses'), undefined)
})

test('la teinte proposée est la moins servie de la palette', () => {
  const palette = ['ambre', 'braise', 'airelle'] as const

  // Aucun tag : la première de la palette.
  assert.equal(nextTagColor([], palette), 'ambre')

  // « ambre » est pris, on passe à la suivante.
  assert.equal(nextTagColor([tag({ color_key: 'ambre' })], palette), 'braise')

  // Toutes servies une fois : on repart sur la première, l'égalité étant
  // tranchée par l'ordre de déclaration.
  const complet = palette.map((color_key) => tag({ color_key }))
  assert.equal(nextTagColor(complet, palette), 'ambre')

  // Un déséquilibre l'emporte sur l'ordre de déclaration.
  assert.equal(nextTagColor([...complet, tag({ color_key: 'ambre' })], palette), 'braise')
})

test('une teinte hors palette ne fausse pas le décompte', () => {
  // Le cas arrive après un renommage de la palette : la base garde des clés
  // que le thème ne connaît plus. Elles ne doivent ni compter, ni planter.
  const palette = ['ambre', 'braise'] as const
  assert.equal(nextTagColor([tag({ color_key: 'fjord' })], palette), 'ambre')
})

// ----------------------------------------------------------------- filtres

test('hasAllTags exige tous les tags sélectionnés, pas au moins un', () => {
  const n = composed({ tags: [tag({ id: 'a' }), tag({ id: 'b' })] })
  assert.equal(hasAllTags(n, ['a']), true)
  assert.equal(hasAllTags(n, ['a', 'b']), true)
  assert.equal(hasAllTags(n, ['a', 'c']), false)
  assert.equal(hasAllTags(n, []), true)
})

test('filterNotes sépare la vue active de la vue archivée', () => {
  const all = [
    composed({ id: 'active', is_archived: false }),
    composed({ id: 'archivee', is_archived: true }),
  ]
  const base = { tagIds: [], search: '' }
  assert.deepEqual(filterNotes(all, { ...base, view: 'active' }).map((n) => n.id), ['active'])
  assert.deepEqual(filterNotes(all, { ...base, view: 'archived' }).map((n) => n.id), ['archivee'])
})

test('filterNotes combine tag et recherche', () => {
  const maison = tag({ id: 'tm', name: 'maison' })
  const all = [
    composed({ id: 'ok', title: 'Devis charpente', tags: [maison] }),
    composed({ id: 'mauvais-tag', title: 'Devis toiture', tags: [] }),
    composed({ id: 'mauvais-texte', title: 'Courses', tags: [maison] }),
  ]
  const result = filterNotes(all, { view: 'active', tagIds: ['tm'], search: 'devis' })
  assert.deepEqual(result.map((n) => n.id), ['ok'])
})

test('filterNotes tolère les espaces autour du terme recherché', () => {
  const all = [composed({ id: 'a', title: 'Charpente' })]
  assert.equal(filterNotes(all, { view: 'active', tagIds: [], search: '  charp  ' }).length, 1)
})

// ------------------------------------------------------------- répartition

test('distributeIntoColumns remplit la colonne la plus courte', () => {
  // Hauteurs 10, 10, 10 sur deux colonnes : la troisième repart à gauche.
  const columns = distributeIntoColumns(['a', 'b', 'c'], 2, () => 10)
  assert.deepEqual(columns, [['a', 'c'], ['b']])
})

test('distributeIntoColumns équilibre malgré des hauteurs très inégales', () => {
  const heights: Record<string, number> = { grande: 100, p1: 10, p2: 10, p3: 10 }
  const columns = distributeIntoColumns(
    ['grande', 'p1', 'p2', 'p3'],
    2,
    (id) => heights[id],
  )
  // La grande occupe une colonne, les trois petites tiennent dans l'autre.
  assert.deepEqual(columns[0], ['grande'])
  assert.deepEqual(columns[1], ['p1', 'p2', 'p3'])
})

test('distributeIntoColumns ne perd aucun élément', () => {
  const items = Array.from({ length: 37 }, (_, i) => `n${i}`)
  const columns = distributeIntoColumns(items, 3, (id) => id.length * 7)
  assert.equal(columns.flat().length, 37)
  assert.equal(new Set(columns.flat()).size, 37)
})

test('distributeIntoColumns tient face à un nombre de colonnes absurde', () => {
  assert.deepEqual(distributeIntoColumns(['a'], 0, () => 1), [['a']])
})

test('columnsForWidth suit les paliers attendus', () => {
  assert.equal(columnsForWidth(360), 1)
  assert.equal(columnsForWidth(400), 2)
  assert.equal(columnsForWidth(800), 3)
  assert.equal(columnsForWidth(1400), 4)
})

// ---------------------------------------------------------- notes vides

test('une note sans aucun contenu est vide', () => {
  assert.equal(isEmptyNote(composed()), true)
  assert.equal(isEmptyNote(composed({ kind: 'checklist' })), true)
})

test('un titre fait sortir de l’état vide, même sans corps', () => {
  assert.equal(isEmptyNote(composed({ title: 'Titre seul' })), false)
})

test('un titre uniquement composé d’espaces reste vide', () => {
  // La contrainte SQL refuse un titre blanc, l'éditeur enregistre null :
  // les deux doivent donner le même verdict.
  assert.equal(isEmptyNote(composed({ title: '   ' })), true)
  assert.equal(isEmptyNote(composed({ body: '  \n ' })), true)
})

test('une couleur ou un tag suffit à préserver la note', () => {
  // Teinter ou classer une note est une intention explicite : l'écarter
  // reviendrait à détruire du travail.
  assert.equal(isEmptyNote(composed({ color_key: 'fjord' })), false)
  assert.equal(isEmptyNote(composed({ tags: [tag()] })), false)
})

test('un élément de liste suffit à préserver la note', () => {
  assert.equal(isEmptyNote(composed({ kind: 'checklist', items: [item()] })), false)
})

test('un nom de code suffit à préserver la note', () => {
  // Ranger une note dans le coffre sous un nom est une intention explicite,
  // au même titre que la teinter. L'écarter en sortant de l'éditeur effacerait
  // un geste délibéré.
  assert.equal(
    isEmptyNote(composed({ is_private: true, code_name: 'Ancre' })),
    false,
  )
})

// -------------------------------------------------------------- coffre

test('une note visible affiche son titre', () => {
  assert.equal(displayTitle({ title: 'Courses', is_private: false, code_name: null }), 'Courses')
})

test('une note du coffre affiche son nom de code, jamais son titre', () => {
  assert.equal(
    displayTitle({ title: 'Mot de passe wifi', is_private: true, code_name: 'Ancre' }),
    'Ancre',
  )
})

test('une note du coffre sans nom de code n’affiche rien', () => {
  // Le point sensible de tout le coffre. Un repli sur le titre serait invisible
  // à l'usage et laisserait fuir exactement ce que le coffre doit cacher.
  assert.equal(displayTitle({ title: 'Mot de passe wifi', is_private: true, code_name: null }), null)
})

test('les premiers essais ne sont pas temporisés', () => {
  for (let i = 0; i <= FREE_ATTEMPTS; i++) {
    assert.equal(delayForFailures(i), 0, `échec numéro ${i}`)
  }
})

test('la temporisation double puis plafonne', () => {
  const first = delayForFailures(FREE_ATTEMPTS + 1)
  const second = delayForFailures(FREE_ATTEMPTS + 2)
  assert.ok(first > 0)
  assert.equal(second, first * 2)
  // Le plafond existe : sans lui, une poignée d'erreurs de plus enfermerait le
  // propriétaire du téléphone pour des heures.
  assert.equal(delayForFailures(50), delayForFailures(60))
  assert.ok(delayForFailures(50) <= 5 * 60_000)
})

test('une empreinte correcte ouvre et remet les compteurs à zéro', () => {
  const verdict = judgePin('bon', { salt: 's', hash: 'bon', failures: 2, lockedUntil: null, biometrics: false }, 1000)
  assert.equal(verdict.ok, true)
  assert.equal(verdict.secret.failures, 0)
  assert.equal(verdict.secret.lockedUntil, null)
})

test('une empreinte fausse incrémente sans verrouiller tout de suite', () => {
  const verdict = judgePin('faux', { salt: 's', hash: 'bon', failures: 0, lockedUntil: null, biometrics: false }, 1000)
  assert.equal(verdict.ok, false)
  assert.equal(verdict.secret.failures, 1)
  assert.equal(verdict.secret.lockedUntil, null)
})

test('la temporisation démarre au bon horodatage', () => {
  const now = 10_000
  const verdict = judgePin(
    'faux',
    { salt: 's', hash: 'bon', failures: FREE_ATTEMPTS, lockedUntil: null, biometrics: false },
    now,
  )
  assert.equal(verdict.ok, false)
  assert.equal(verdict.secret.lockedUntil, now + delayForFailures(FREE_ATTEMPTS + 1))
})

test('pendant la temporisation, même le bon code est refusé', () => {
  // Le point qui compte : sans cette garde, il suffirait de connaître le code
  // pour que l'attente ne serve à rien, et le compteur d'échecs deviendrait
  // décoratif.
  const verdict = judgePin(
    'bon',
    { salt: 's', hash: 'bon', failures: 5, lockedUntil: 50_000, biometrics: false },
    40_000,
  )
  assert.equal(verdict.ok, false)
  assert.equal(verdict.reason, 'cooling')
  assert.equal(verdict.waitMs, 10_000)
})

test('la temporisation expirée laisse repasser', () => {
  const verdict = judgePin(
    'bon',
    { salt: 's', hash: 'bon', failures: 5, lockedUntil: 50_000, biometrics: false },
    50_001,
  )
  assert.equal(verdict.ok, true)
})

// ------------------------------------------------------ coffre : chiffrement

/**
 * Aléa de test. Le vrai vient d'expo-crypto sur l'appareil : le cœur n'en sait
 * rien, c'est tout l'intérêt de le lui passer en argument.
 */
const random = (n: number) => new Uint8Array(nodeRandomBytes(n))

test('un texte chiffré se relit à l’identique avec sa clé', () => {
  const key = createDataKey(random)
  const sealed = sealText('Rendez-vous mardi, 14 h.', key, random)
  assert.notEqual(sealed, 'Rendez-vous mardi, 14 h.')
  assert.equal(openText(sealed, key), 'Rendez-vous mardi, 14 h.')
})

test('les accents et les emojis survivent au tour complet', () => {
  const key = createDataKey(random)
  const texte = 'Élève à l’école — 100 % ✔ ᚦ'
  assert.equal(openText(sealText(texte, key, random), key), texte)
})

test('deux chiffrements du même texte ne se ressemblent pas', () => {
  // Nonce tiré au sort à chaque écriture : sans cela, deux notes identiques se
  // reconnaîtraient dans la base sans être déchiffrées.
  const key = createDataKey(random)
  assert.notEqual(sealText('courses', key, random), sealText('courses', key, random))
})

test('une autre clé ne déchiffre rien', () => {
  const sealed = sealText('secret', createDataKey(random), random)
  assert.equal(openText(sealed, createDataKey(random)), null)
})

test('un chiffré altéré d’un seul caractère est refusé, pas déchiffré de travers', () => {
  const key = createDataKey(random)
  const sealed = sealText('solde du compte', key, random)
  // On retourne le dernier chiffre hexadécimal : le poinçon d'authenticité doit
  // s'en apercevoir. C'est toute la différence entre chiffrer et authentifier.
  const altered = sealed.slice(0, -1) + (sealed.at(-1) === '0' ? '1' : '0')
  assert.equal(openText(altered, key), null)
})

test('une chaîne qui n’est pas un chiffré ne fait pas tomber la lecture', () => {
  assert.equal(openText('pas du tout hexadécimal', createDataKey(random)), null)
  assert.equal(openText('', createDataKey(random)), null)
})

test('la clé de données se retrouve avec la clé de secours', () => {
  const dataKey = createDataKey(random)
  const recovery = createRecoveryKey(random)
  const wrapped = wrapDataKey(dataKey, recovery, random)
  assert.deepEqual(unwrapDataKey(wrapped, recovery), dataKey)
})

test('une mauvaise clé de secours ne rend pas la clé de données', () => {
  const wrapped = wrapDataKey(createDataKey(random), createRecoveryKey(random), random)
  assert.equal(unwrapDataKey(wrapped, createRecoveryKey(random)), null)
})

test('la clé de secours se lit en huit groupes de quatre', () => {
  const key = createRecoveryKey(random)
  const shown = formatRecoveryKey(key)
  assert.match(shown, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){7}$/)
  assert.deepEqual(parseRecoveryKey(shown), key)
})

test('la relecture pardonne la casse, les espaces et les confusions O/0 et I/1', () => {
  const key = createRecoveryKey(random)
  const shown = formatRecoveryKey(key)
  assert.deepEqual(parseRecoveryKey(shown.toLowerCase()), key)
  assert.deepEqual(parseRecoveryKey(shown.replace(/-/g, ' ')), key)
  // Une clé recopiée avec des O et des I là où il y avait des 0 et des 1 doit
  // tomber juste : c'est l'erreur de recopie la plus fréquente, et la seule que
  // l'alphabet permet de rattraper sans ambiguïté.
  assert.deepEqual(parseRecoveryKey(shown.replace(/0/g, 'O').replace(/1/g, 'I')), key)
})

test('une clé de secours tronquée est refusée avant tout déchiffrement', () => {
  const shown = formatRecoveryKey(createRecoveryKey(random))
  assert.equal(parseRecoveryKey(shown.slice(0, 20)), null)
  assert.equal(parseRecoveryKey(''), null)
  // Caractère hors alphabet : refusé aussi, plutôt qu'ignoré en silence.
  assert.equal(parseRecoveryKey(shown.slice(0, -1) + 'U'), null)
})

// ------------------------------------------- mots de passe compromis

test('l’empreinte se coupe en cinq caractères envoyés et trente-cinq gardés', () => {
  // SHA-1 de « password », le mot de passe le plus fuité de tous.
  const parts = splitHash('5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8')
  assert.equal(parts?.prefix, '5BAA6')
  assert.equal(parts?.suffix, '1E4C9B93F3F0682250B6CF8331B7EE68FD8')
  assert.equal(parts!.prefix.length + parts!.suffix.length, 40)
})

test('une empreinte mal formée est refusée plutôt que tronquée', () => {
  assert.equal(splitHash('trop court'), null)
  assert.equal(splitHash(''), null)
  // Un caractère hors de l'hexadécimal, à la toute fin.
  assert.equal(splitHash('5baa61e4c9b93f3f0682250b6cf8331b7ee68fdZ'), null)
})

test('un suffixe présent rend son nombre de fuites', () => {
  const body = '1E4C9B93F3F0682250B6CF8331B7EE68FD8:9659365\r\n0018A45C4D1DEF81644B54AB7F969B88D65:1'
  assert.equal(countInRange(body, '1E4C9B93F3F0682250B6CF8331B7EE68FD8'), 9659365)
})

test('un suffixe absent rend zéro', () => {
  const body = '0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2'
  assert.equal(countInRange(body, '1E4C9B93F3F0682250B6CF8331B7EE68FD8'), 0)
})

test('la comparaison ignore la casse', () => {
  // Le service répond en majuscules, mais rien ne l'y oblige contractuellement.
  const body = '1e4c9b93f3f0682250b6cf8331b7ee68fd8:42'
  assert.equal(countInRange(body, '1E4C9B93F3F0682250B6CF8331B7EE68FD8'), 42)
})

test('les lignes de rembourrage à compte nul ne comptent pas', () => {
  // Sans cette règle, le rembourrage ferait refuser tous les mots de passe.
  const body = '1E4C9B93F3F0682250B6CF8331B7EE68FD8:0\r\n0018A45C4D1DEF81644B54AB7F969B88D65:1'
  assert.equal(countInRange(body, '1E4C9B93F3F0682250B6CF8331B7EE68FD8'), 0)
})

test('une réponse illisible ne fait pas tomber le contrôle', () => {
  assert.equal(countInRange('', 'ABC'), 0)
  assert.equal(countInRange('pas de séparateur ici', 'ABC'), 0)
  assert.equal(countInRange('ABC:pas un nombre', 'ABC'), 0)
})

// ------------------------------------------------- créneaux d'agenda

/**
 * Une date de référence fixe, sinon ces tests passeraient ou non selon l'heure
 * à laquelle on les lance — le pire genre de test, celui qui échoue le
 * vendredi soir sans que rien n'ait changé.
 */
const MIDI = new Date(2026, 7, 8, 12, 0, 0, 0) // 8 août 2026, 12:00

test('le créneau proposé est la prochaine heure ronde', () => {
  const p = prochainCreneau(new Date(2026, 7, 8, 14, 37, 12))
  assert.equal(p.date, '08/08/2026')
  assert.equal(p.heure, '15:00')
})

test('la prochaine heure ronde passe au lendemain après 23 h', () => {
  const p = prochainCreneau(new Date(2026, 7, 8, 23, 10))
  assert.equal(p.date, '09/08/2026')
  assert.equal(p.heure, '00:00')
})

test('un créneau valide donne un début et une fin cohérents', () => {
  const r = lireCreneau('12/08/2026', '14:00', 60, MIDI)
  assert.ok(r.ok)
  assert.equal(r.creneau.debut.getHours(), 14)
  assert.equal(r.creneau.fin.getTime() - r.creneau.debut.getTime(), 60 * 60_000)
})

test('le 31 février est refusé, et non décalé en mars', () => {
  // `new Date(2026, 1, 31)` rend le 3 mars sans se plaindre : c'est
  // précisément le glissement que cette validation existe pour empêcher.
  const r = lireCreneau('31/02/2026', '10:00', 60, MIDI)
  assert.equal(r.ok, false)
})

test('le 29 février d’une année commune est refusé', () => {
  assert.equal(lireCreneau('29/02/2026', '10:00', 60, MIDI).ok, false)
  // 2028 est bissextile : celui-là doit passer.
  assert.equal(lireCreneau('29/02/2028', '10:00', 60, MIDI).ok, true)
})

test('les formats de date et d’heure sont contrôlés', () => {
  assert.equal(lireCreneau('2026-08-12', '14:00', 60, MIDI).ok, false)
  assert.equal(lireCreneau('12/08/2026', '14h00', 60, MIDI).ok, false)
  assert.equal(lireCreneau('12/08/2026', '25:00', 60, MIDI).ok, false)
  assert.equal(lireCreneau('12/08/2026', '14:60', 60, MIDI).ok, false)
})

test('un créneau passé est refusé', () => {
  const r = lireCreneau('01/08/2026', '10:00', 60, MIDI)
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.erreur, /passé/)
})

test('la minute de tolérance évite un refus pour quelques secondes', () => {
  // Saisi à 12:00 pile, validé trente secondes plus tard.
  const trenteSecondesApres = new Date(MIDI.getTime() + 30_000)
  assert.equal(lireCreneau('08/08/2026', '12:00', 60, trenteSecondesApres).ok, true)
})

test('une durée nulle ou négative est refusée', () => {
  assert.equal(lireCreneau('12/08/2026', '14:00', 0, MIDI).ok, false)
  assert.equal(lireCreneau('12/08/2026', '14:00', -30, MIDI).ok, false)
})

test('le décalage de jours franchit les fins de mois', () => {
  assert.equal(decalerJours('31/08/2026', 1), '01/09/2026')
  assert.equal(decalerJours('28/02/2028', 1), '29/02/2028')
  assert.equal(decalerJours('31/12/2026', 7), '07/01/2027')
})

test('le décalage laisse passer une date illisible sans planter', () => {
  assert.equal(decalerJours('pas une date', 1), 'pas une date')
})

test('le format de date est bien à deux chiffres', () => {
  assert.equal(formaterDate(new Date(2026, 0, 5)), '05/01/2026')
})
