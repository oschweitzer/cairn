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
  byPinThenOrder,
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
  moveNote,
  nextTagColor,
  type NoteWithRelations,
} from '../src/db/noteLogic'
import { describeDbError } from '../src/db/errors'
import type { Note, PlainChecklistItem, Tag } from '../src/db/types'
import {
  applyFormat,
  insertLink,
  linkAt,
  normalizeHref,
  parseMarkup,
  plainText,
} from '../src/text/markup'
import { buildSnapshot } from '../src/widget/snapshot'
import { PERSISTABLE_PREFIX, QUERY_ROOT, shouldPersistQuery } from '../src/db/persistLogic'
// The cache round trip is replayed for real below. React Query brings its own
// client and its dehydrate/hydrate pair, and neither needs React to run.
import { QueryClient, dehydrate, hydrate } from '@tanstack/react-query'
import {
  AUTO_LOCK_MS,
  delayForFailures,
  judgePin,
  msBeforeAutoLock,
  FREE_ATTEMPTS,
} from '../src/vault/policy'
import { countInRange, splitHash } from '../src/auth/pwnedLogic'
import {
  decalerJours,
  formaterDate,
  lireCreneau,
  prochainCreneau,
  SEGMENTS_DATE,
  SEGMENTS_HEURE,
  SEPARATEUR_DATE,
  SEPARATEUR_HEURE,
} from '../src/google/creneau'
import {
  completerSegments,
  composerSegments,
  separerSegments,
} from '../src/ui/segments'
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
    position: 0,
    is_private: false,
    code_name: null,
    hide_content: false,
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

test('byPinThenOrder place les épinglées devant, puis les plus récentes', () => {
  const list = [
    note({ id: 'vieille', updated_at: '2026-01-01T00:00:00Z' }),
    note({ id: 'epinglee', is_pinned: true, updated_at: '2025-01-01T00:00:00Z' }),
    note({ id: 'recente', updated_at: '2026-06-01T00:00:00Z' }),
  ]
  assert.deepEqual([...list].sort(byPinThenOrder).map((n) => n.id), [
    'epinglee',
    'recente',
    'vieille',
  ])
})

test('le rang choisi passe devant la date', () => {
  const list = [
    note({ id: 'a', position: 2, updated_at: '2026-06-01T00:00:00Z' }),
    note({ id: 'b', position: 0, updated_at: '2026-01-01T00:00:00Z' }),
    note({ id: 'c', position: 1, updated_at: '2026-05-01T00:00:00Z' }),
  ]
  assert.deepEqual([...list].sort(byPinThenOrder).map((n) => n.id), ['b', 'c', 'a'])
})

test('une note fraîchement créée arrive en tête', () => {
  // Elle naît au rang zéro, donc à égalité avec la première, et gagne le
  // départage puisqu'elle est la plus récente. C'est ce qui évite d'avoir à
  // réécrire les rangs de toute la grille à chaque création.
  const list = [
    note({ id: 'ancienne', position: 0, updated_at: '2026-01-01T00:00:00Z' }),
    note({ id: 'suivante', position: 1, updated_at: '2026-02-01T00:00:00Z' }),
    note({ id: 'neuve', position: 0, updated_at: '2026-08-09T00:00:00Z' }),
  ]
  assert.equal([...list].sort(byPinThenOrder)[0].id, 'neuve')
})

// ---------------------------------------------------------- glisser-déposer

test('déposer une note sur une autre lui prend sa place', () => {
  const list = ['a', 'b', 'c', 'd'].map((id) => note({ id }))
  assert.deepEqual(moveNote(list, 0, 2).map((n) => n.id), ['b', 'c', 'a', 'd'])
  assert.deepEqual(moveNote(list, 3, 0).map((n) => n.id), ['d', 'a', 'b', 'c'])
})

test('les épinglées restent en tête, où qu’on dépose', () => {
  // Déposer une note ordinaire au milieu des épinglées la pose juste après
  // elles : c'est la place la plus proche de celle visée, et refuser le geste
  // sans rien dire se lirait comme un bug.
  const list = [
    note({ id: 'p1', is_pinned: true }),
    note({ id: 'p2', is_pinned: true }),
    note({ id: 'x' }),
    note({ id: 'y' }),
  ]
  assert.deepEqual(moveNote(list, 3, 0).map((n) => n.id), ['p1', 'p2', 'y', 'x'])
})

test('une épinglée ne peut pas descendre sous les ordinaires', () => {
  const list = [
    note({ id: 'p1', is_pinned: true }),
    note({ id: 'x' }),
    note({ id: 'y' }),
  ]
  assert.deepEqual(moveNote(list, 0, 2).map((n) => n.id), ['p1', 'x', 'y'])
})

test('les épinglées se réordonnent entre elles', () => {
  const list = [
    note({ id: 'p1', is_pinned: true }),
    note({ id: 'p2', is_pinned: true }),
    note({ id: 'x' }),
  ]
  assert.deepEqual(moveNote(list, 1, 0).map((n) => n.id), ['p2', 'p1', 'x'])
})

test('un déplacement sans effet rend la liste telle quelle', () => {
  const list = [note({ id: 'a' }), note({ id: 'b' })]
  assert.equal(moveNote(list, 1, 1), list)
  assert.equal(moveNote(list, 5, 0), list)
})

// ------------------------------------------------------- instantané du widget

test('le widget ne reçoit ni corbeille ni archive', () => {
  const snap = buildSnapshot(
    [
      composed({ id: 'vivante', title: 'Vivante' }),
      composed({ id: 'archivee', title: 'Archivée', is_archived: true }),
      composed({ id: 'jetee', title: 'Jetée', deleted_at: '2026-08-01T00:00:00Z' }),
    ],
    [],
    { showPrivate: false },
  )
  assert.deepEqual(snap.notes.map((n) => n.id), ['vivante'])
})

test('le coffre reste dehors par défaut', () => {
  const notes = [
    composed({ id: 'claire', title: 'Claire' }),
    composed({ id: 'cachee', is_private: true, code_name: 'Basalte', title: 'Vrai titre' }),
  ]
  assert.deepEqual(
    buildSnapshot(notes, [], { showPrivate: false }).notes.map((n) => n.id),
    ['claire'],
  )
})

test('une note du coffre montrée ne livre que son nom de code', () => {
  // Le réglage dit « je veux savoir qu'elle est là », pas « je veux que son
  // contenu s'affiche sur l'écran d'accueil du téléphone ».
  const snap = buildSnapshot(
    [composed({ id: 'x', is_private: true, code_name: 'Basalte', title: 'Vrai titre', body: 'secret' })],
    [],
    { showPrivate: true },
  )
  assert.equal(snap.notes[0].title, 'Basalte')
  assert.equal(snap.notes[0].preview, '')
})

test('l’aperçu du widget est débarrassé du balisage', () => {
  // Une RemoteViews ne sait pas ce qu'est une astérisque : `**gras**`
  // s'afficherait tel quel sur l'écran d'accueil.
  const snap = buildSnapshot(
    [composed({ id: 'x', body: 'Voir le **relevé** et [la carte](https://exemple.fr)' })],
    [],
    { showPrivate: false },
  )
  assert.equal(snap.notes[0].preview, 'Voir le relevé et la carte')
})

test('l’aperçu d’une liste montre ses éléments', () => {
  const snap = buildSnapshot(
    [
      composed({
        id: 'x',
        kind: 'checklist',
        items: [item({ id: 'i1', content: 'Pain' }), item({ id: 'i2', content: 'Café' })],
      }),
    ],
    [],
    { showPrivate: false },
  )
  assert.equal(snap.notes[0].preview, '• Pain\n• Café')
  assert.equal(snap.notes[0].checklist, true)
})

test('l’ordre du widget est celui de la grille', () => {
  const snap = buildSnapshot(
    [
      composed({ id: 'ordinaire', position: 0 }),
      composed({ id: 'epinglee', is_pinned: true, position: 5 }),
    ],
    [],
    { showPrivate: false },
  )
  assert.deepEqual(snap.notes.map((n) => n.id), ['epinglee', 'ordinaire'])
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

// ------------------------------------------------------- mise en forme

/** Raccourci de lecture : « texte(marques) » pour chaque fragment. */
function rendu(source: string): string {
  return parseMarkup(source)
    .map((block) => {
      const spans = block.spans
        .map((s) => {
          const marks = [
            s.bold ? 'gras' : null,
            s.italic ? 'ital' : null,
            s.underline ? 'soul' : null,
            s.strike ? 'barr' : null,
            s.href ? `→${s.href}` : null,
          ].filter(Boolean)
          return marks.length ? `${s.text}(${marks.join(',')})` : s.text
        })
        .join('')
      const prefix = block.kind === 'bullet' ? '• ' : block.level ? `h${block.level} ` : ''
      return prefix + spans
    })
    .join('\n')
}

test('les quatre marques d’emphase se rendent', () => {
  assert.equal(rendu('**gras**'), 'gras(gras)')
  assert.equal(rendu('*ital*'), 'ital(ital)')
  assert.equal(rendu('__soul__'), 'soul(soul)')
  assert.equal(rendu('~~barr~~'), 'barr(barr)')
})

test('le gras gagne sur l’italique à position égale', () => {
  // Les deux règles trouvent une correspondance à l'indice zéro sur `**x**` :
  // sans priorité, l'italique capturerait `*x` et le texte perdrait une étoile.
  assert.equal(rendu('**mot**'), 'mot(gras)')
})

test('les marques s’emboîtent', () => {
  assert.equal(rendu('**gras et *aussi ital***'), 'gras et (gras)aussi ital(gras,ital)')
})

test('une marque non refermée reste du texte', () => {
  assert.equal(rendu('deux * trois'), 'deux * trois')
  assert.equal(rendu('**ouvert sans fin'), '**ouvert sans fin')
})

test('les titres et les puces sont des blocs', () => {
  assert.equal(rendu('# Grand\n## Petit\n- item'), 'h1 Grand\nh2 Petit\n• item')
})

test('une ligne vide reste une ligne', () => {
  // Elle porte l'aération voulue : l'avaler resserrerait le texte à l'affichage.
  assert.equal(parseMarkup('a\n\nb').length, 3)
})

test('une URL écrite au fil du texte devient un lien', () => {
  assert.equal(
    rendu('voir https://exemple.fr ici'),
    'voir https://exemple.fr(→https://exemple.fr) ici',
  )
})

test('la ponctuation finale ne part pas dans l’adresse', () => {
  // Erreur classique, et invisible jusqu'au jour où le lien ne s'ouvre pas.
  assert.equal(rendu('voir https://exemple.fr.'), 'voir https://exemple.fr(→https://exemple.fr).')
})

test('une adresse sans protocole est complétée', () => {
  assert.equal(normalizeHref('www.exemple.fr'), 'https://www.exemple.fr')
  assert.equal(normalizeHref('https://exemple.fr'), 'https://exemple.fr')
  assert.equal(rendu('www.exemple.fr'), 'www.exemple.fr(→https://www.exemple.fr)')
})

test('un lien nommé garde son libellé, mise en forme comprise', () => {
  assert.equal(
    rendu('[le **relevé**](https://exemple.fr/x)'),
    'le (→https://exemple.fr/x)relevé(gras,→https://exemple.fr/x)',
  )
})

test('le texte nu retire le balisage', () => {
  assert.equal(plainText('**gras** et [libellé](https://x.fr)'), 'gras et libellé')
  assert.equal(plainText('- courses\n- pain'), '• courses\n• pain')
  assert.equal(plainText(null), '')
})

test('la recherche traverse la mise en forme', () => {
  // Le cas qui compte : « liste de courses » ne se trouvait plus dès que seul
  // « courses » était en gras, le haystack contenant « liste de **courses** ».
  const n = composed({ body: 'liste de **courses** du samedi' })
  assert.equal(matchesSearch(n, fold('liste de courses')), true)
})

// ------------------------------------------------------- commandes d’édition

test('la commande enveloppe la sélection', () => {
  const r = applyFormat('un mot ici', { start: 3, end: 6 }, 'bold')
  assert.equal(r.text, 'un **mot** ici')
  assert.equal(r.selection.start, 5)
  assert.equal(r.selection.end, 8)
})

test('sans sélection, la commande prend le mot sous le curseur', () => {
  // Écrire un mot puis appuyer sur « gras » est le geste le plus naturel ; sans
  // cette extension, il posait deux paires d'astérisques autour du vide.
  assert.equal(applyFormat('un mot ici', { start: 4, end: 4 }, 'italic').text, 'un *mot* ici')
})

test('réappuyer sur la même marque la retire', () => {
  assert.equal(applyFormat('un **mot** ici', { start: 5, end: 8 }, 'bold').text, 'un mot ici')
})

test('les commandes de bloc basculent au lieu de s’empiler', () => {
  assert.equal(applyFormat('titre', { start: 0, end: 0 }, 'title').text, '# titre')
  assert.equal(applyFormat('# titre', { start: 2, end: 2 }, 'title').text, 'titre')
})

test('une ligne ne porte qu’une marque de bloc', () => {
  // Passer de titre à puce retire le dièse au lieu de préfixer deux fois.
  assert.equal(applyFormat('# titre', { start: 2, end: 2 }, 'bullet').text, '- titre')
})

test('la commande de bloc ne touche que sa ligne', () => {
  const r = applyFormat('un\ndeux\ntrois', { start: 4, end: 4 }, 'bullet')
  assert.equal(r.text, 'un\n- deux\ntrois')
})

test('le lien réutilise la sélection comme libellé et pose le curseur dans l’adresse', () => {
  const r = insertLink('voir le relevé', { start: 8, end: 14 })
  assert.equal(r.text, 'voir le [relevé]()')
  assert.equal(r.text[r.selection.start], ')')
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

test('a fresh gesture buys the whole delay back', () => {
  const now = 1_000_000
  assert.equal(msBeforeAutoLock(now, now), AUTO_LOCK_MS)
})

test('what is left is counted from the last gesture, not from the unlock', () => {
  const now = 1_000_000
  assert.equal(msBeforeAutoLock(now - 60_000, now), AUTO_LOCK_MS - 60_000)
})

test('an absence longer than the delay closes the vault, and never overshoots', () => {
  // Zero and not a negative number: the value goes straight back into a timer,
  // and a negative delay would make it fire in a loop. An hour away and a
  // fraction over five minutes must answer the same thing — close now.
  const now = 1_000_000
  assert.equal(msBeforeAutoLock(now - AUTO_LOCK_MS, now), 0)
  assert.equal(msBeforeAutoLock(now - 3_600_000, now), 0)
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

test('l’heure se découpe en deux moitiés de deux chiffres', () => {
  const separer = (v: string) => separerSegments(v, SEPARATEUR_HEURE, SEGMENTS_HEURE)
  assert.deepEqual(separer('14:30'), ['14', '30'])
  assert.deepEqual(separer('9:5'), ['9', '5'])
  // Une moitié vide reste une chaîne : le champ correspondant s'affiche vide
  // plutôt que de basculer en non contrôlé.
  assert.deepEqual(separer(''), ['', ''])
  assert.deepEqual(separer('14:'), ['14', ''])
})

test('la date se découpe en jour, mois et année', () => {
  const separer = (v: string) => separerSegments(v, SEPARATEUR_DATE, SEGMENTS_DATE)
  assert.deepEqual(separer('28/08/2026'), ['28', '08', '2026'])
  assert.deepEqual(separer('5/8/26'), ['5', '8', '26'])
  assert.deepEqual(separer(''), ['', '', ''])
})

test('le découpage jette ce qui n’est pas un chiffre', () => {
  assert.deepEqual(separerSegments(' 14 : 3o ', SEPARATEUR_HEURE, SEGMENTS_HEURE), ['14', '3'])
  assert.deepEqual(separerSegments('149:305', SEPARATEUR_HEURE, SEGMENTS_HEURE), ['14', '30'])
  // L'année en accepte quatre là où le jour en accepte deux.
  assert.deepEqual(separerSegments('288/8/20266', SEPARATEUR_DATE, SEGMENTS_DATE), [
    '28',
    '8',
    '2026',
  ])
})

test('les moitiés se recomposent dans le format attendu', () => {
  assert.equal(composerSegments(['14', '30'], SEPARATEUR_HEURE, SEGMENTS_HEURE), '14:30')
  assert.equal(composerSegments(['28', '08', '2026'], SEPARATEUR_DATE, SEGMENTS_DATE), '28/08/2026')
  assert.equal(composerSegments([], SEPARATEUR_DATE, SEGMENTS_DATE), '//')
  // Ce que la recomposition rend doit rester lisible par `lireCreneau`, sans
  // quoi les champs produiraient un créneau que le panneau refuse.
  const date = composerSegments(['12', '08', '2026'], SEPARATEUR_DATE, SEGMENTS_DATE)
  const heure = composerSegments(['9', '05'], SEPARATEUR_HEURE, SEGMENTS_HEURE)
  assert.equal(lireCreneau(date, heure, 60, MIDI).ok, true)
})

test('un chiffre seul reçoit son zéro devant à la sortie du champ', () => {
  assert.equal(completerSegments('9:5', SEPARATEUR_HEURE, SEGMENTS_HEURE), '09:05')
  assert.equal(completerSegments('14:30', SEPARATEUR_HEURE, SEGMENTS_HEURE), '14:30')
  assert.equal(completerSegments('5/8/2026', SEPARATEUR_DATE, SEGMENTS_DATE), '05/08/2026')
})

test('l’année n’est pas complétée : « 26 » n’est pas 2026', () => {
  // Compléter choisirait un siècle que personne n'a saisi. La date reste
  // incomplète, et le panneau continue de dire ce qu'il attend.
  assert.equal(completerSegments('05/08/26', SEPARATEUR_DATE, SEGMENTS_DATE), '05/08/26')
  assert.equal(lireCreneau('05/08/26', '10:00', 60, MIDI).ok, false)
})

test('une moitié laissée vide n’est pas devinée', () => {
  // Mettre « 00 » choisirait une valeur que personne n'a saisie.
  assert.equal(completerSegments('14:', SEPARATEUR_HEURE, SEGMENTS_HEURE), '14:')
  assert.equal(completerSegments('/08/2026', SEPARATEUR_DATE, SEGMENTS_DATE), '/08/2026')
})

// --- Naming a database failure -----------------------------------------------

test('a missing column reads as a database left behind', () => {
  const r = describeDbError({ code: '42703', message: 'column notes.position does not exist' })
  assert.equal(r.kind, 'schema')
  assert.match(r.title, /retard/)
})

test('a missing RPC and a missing table land in the same place', () => {
  for (const code of ['42P01', '42883', 'PGRST200', 'PGRST202', 'PGRST204']) {
    assert.equal(describeDbError({ code, message: 'nope' }).kind, 'schema')
  }
})

test('the raw message survives, underneath', () => {
  const r = describeDbError({ code: '42703', message: 'column notes.position does not exist' })
  assert.equal(r.detail, '42703 · column notes.position does not exist')
})

test('a hint from Postgres is kept', () => {
  const r = describeDbError({ code: '42883', message: 'function reorder_notes', hint: 'no match' })
  assert.match(r.detail ?? '', /no match/)
})

test('RLS refusing is not a missing migration', () => {
  assert.equal(describeDbError({ code: '42501', message: 'new row violates' }).kind, 'permission')
})

test('an expired token asks for a sign-in, not for a migration', () => {
  assert.equal(describeDbError({ code: 'PGRST301', message: 'JWT expired' }).kind, 'session')
})

test('a failed fetch is a connection, and says waiting will help', () => {
  const r = describeDbError(new TypeError('Failed to fetch'))
  assert.equal(r.kind, 'network')
  assert.match(r.message, /connexion/)
})

test('a coded error is never read as a network failure, whatever it says', () => {
  // PostgREST does answer over HTTP: its wording may well mention fetching.
  const r = describeDbError({ code: '42703', message: 'failed to fetch column' })
  assert.equal(r.kind, 'schema')
})

test('an unrecognised error keeps showing itself', () => {
  const r = describeDbError({ code: 'XX000', message: 'internal error' })
  assert.equal(r.kind, 'unknown')
  assert.equal(r.message, 'XX000 · internal error')
  assert.equal(r.detail, null)
})

test('nothing at all still produces something readable', () => {
  for (const nothing of [null, undefined, {}, 42]) {
    const r = describeDbError(nothing)
    assert.equal(r.kind, 'unknown')
    assert.equal(r.message, 'Erreur inconnue.')
  }
})

// ------------------------------------------------ what reaches the disk

test('a successful query in the shared scope is persisted', () => {
  assert.equal(shouldPersistQuery([QUERY_ROOT, PERSISTABLE_PREFIX, 'notes'], 'success'), true)
  assert.equal(
    shouldPersistQuery([QUERY_ROOT, PERSISTABLE_PREFIX, 'checklist-items', 'a,b'], 'success'),
    true,
  )
})

test('the vault and the trash never reach the disk', () => {
  // On the web the disk is localStorage, readable by any script on the origin.
  for (const key of ['private-notes', 'private-checklist-items', 'trashed-notes']) {
    assert.equal(shouldPersistQuery([QUERY_ROOT, 'volatile', key], 'success'), false)
  }
  assert.equal(shouldPersistQuery([QUERY_ROOT, 'volatile', 'google-account'], 'success'), false)
  assert.equal(shouldPersistQuery([QUERY_ROOT, 'volatile', 'profile'], 'success'), false)
})

test('a query that has not succeeded is never persisted', () => {
  // A pending query drags its in-flight promise into the payload, JSON turns it
  // into `{}`, and the next hydrate throws on `{}.then` — taking the whole
  // cache with it. This is the regression that made every startup start cold.
  const key = [QUERY_ROOT, PERSISTABLE_PREFIX, 'notes']
  assert.equal(shouldPersistQuery(key, 'pending'), false)
  assert.equal(shouldPersistQuery(key, 'error'), false)
})

test('a key from outside Cairn is left alone', () => {
  assert.equal(shouldPersistQuery(['autre', PERSISTABLE_PREFIX, 'notes'], 'success'), false)
  assert.equal(shouldPersistQuery([], 'success'), false)
})

test('the cache survives the round trip to storage', async () => {
  // The rule read on its own says little; what matters is the whole journey the
  // cache actually makes, which is dehydrate → JSON → hydrate. This is what used
  // to throw `promise.then is not a function` and discard everything on startup.
  const client = new QueryClient()
  client.setQueryData([QUERY_ROOT, PERSISTABLE_PREFIX, 'notes'], [{ id: 'n1', title: 'kept' }])
  client.setQueryData([QUERY_ROOT, 'volatile', 'private-notes'], [{ id: 'vault-only' }])
  client.setQueryData([QUERY_ROOT, 'volatile', 'trashed-notes'], [{ id: 'trashed-only' }])
  // A request still in flight, which is the state every query passes through.
  void client.prefetchQuery({
    queryKey: [QUERY_ROOT, PERSISTABLE_PREFIX, 'checklist-items', 'n1'],
    queryFn: () => new Promise(() => {}),
  })
  await new Promise((done) => setTimeout(done, 10))

  const written = JSON.stringify(
    dehydrate(client, {
      shouldDehydrateQuery: (query) => shouldPersistQuery(query.queryKey, query.state.status),
    }),
  )

  // An unresolved promise serialises to `{}`, and hydrate calls `.then` on it.
  assert.equal(written.includes('"promise"'), false)
  assert.equal(written.includes('vault-only'), false)
  assert.equal(written.includes('trashed-only'), false)

  const restored = new QueryClient()
  hydrate(restored, JSON.parse(written))
  assert.deepEqual(restored.getQueryData([QUERY_ROOT, PERSISTABLE_PREFIX, 'notes']), [
    { id: 'n1', title: 'kept' },
  ])
  assert.equal(restored.getQueryData([QUERY_ROOT, 'volatile', 'private-notes']), undefined)
})

// ------------------------------------------- the link under the caret

test('the caret inside a bare address finds it', () => {
  const texte = 'Voir https://example.com/page pour la suite.'
  const debut = texte.indexOf('https://')
  for (const caret of [debut, debut + 8, debut + 'https://example.com/page'.length]) {
    assert.equal(linkAt(texte, caret)?.href, 'https://example.com/page')
  }
})

test('the caret outside every address finds nothing', () => {
  const texte = 'Voir https://example.com/page pour la suite.'
  assert.equal(linkAt(texte, 0), null)
  assert.equal(linkAt(texte, 4), null)
  assert.equal(linkAt(texte, texte.length), null)
  assert.equal(linkAt('rien du tout', 5), null)
  assert.equal(linkAt('', 0), null)
})

test('an address without a protocol is completed', () => {
  assert.equal(linkAt('www.lemonde.fr', 3)?.href, 'https://www.lemonde.fr')
})

test('the caret in the label of a named link finds the address', () => {
  const texte = 'Un lien [le site](https://example.com) ici.'
  const surLibelle = texte.indexOf('le site') + 2
  const surAdresse = texte.indexOf('https://') + 4
  assert.equal(linkAt(texte, surLibelle)?.href, 'https://example.com')
  assert.equal(linkAt(texte, surAdresse)?.href, 'https://example.com')
})

test('the range covers the whole named link, marks included', () => {
  const texte = 'Un lien [le site](https://example.com) ici.'
  const trouve = linkAt(texte, texte.indexOf('le site'))!
  assert.equal(texte.slice(trouve.start, trouve.end), '[le site](https://example.com)')
})

test('the second of two addresses is found too', () => {
  const texte = 'https://un.example.com et https://deux.example.com'
  assert.equal(linkAt(texte, 5)?.href, 'https://un.example.com')
  assert.equal(linkAt(texte, texte.indexOf('deux') + 2)?.href, 'https://deux.example.com')
  // Between the two, on the word "et", there is no link.
  assert.equal(linkAt(texte, texte.indexOf(' et ') + 2), null)
})

test('trailing punctuation stays out of the address', () => {
  const texte = 'Voir https://example.com, puis autre chose'
  assert.equal(linkAt(texte, 10)?.href, 'https://example.com')
  assert.equal(linkAt(texte, texte.indexOf('puis') + 1), null)
})

test('an address on a later line is found at its own offset', () => {
  const texte = 'Première ligne\n- puce\nhttps://example.com'
  assert.equal(linkAt(texte, texte.indexOf('https://') + 3)?.href, 'https://example.com')
  assert.equal(linkAt(texte, 3), null)
})
