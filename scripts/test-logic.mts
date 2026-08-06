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
  columnsForWidth,
  composeNotes,
  displayTitle,
  distributeIntoColumns,
  filterNotes,
  fold,
  hasAllTags,
  inheritedColor,
  isEmptyNote,
  matchesSearch,
  type NoteWithRelations,
} from '../src/db/noteLogic'
import type { Note, PlainChecklistItem, Tag } from '../src/db/types'
import { delayForFailures, judgePin, FREE_ATTEMPTS } from '../src/vault/policy'
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
