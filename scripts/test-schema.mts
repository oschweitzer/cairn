/**
 * Valide supabase/migrations/ contre du vrai Postgres, sans Docker ni projet distant.
 *
 *   npm run db:test
 *
 * PGlite est Postgres compilé en WebAssembly. Il exécute donc réellement les
 * contraintes, les déclencheurs et les politiques RLS, là où une simple relecture
 * du SQL ne prouve rien.
 *
 * Ce que le test vérifie, au-delà de la syntaxe :
 *   - les invariants métier tiennent au niveau de la base
 *   - un utilisateur ne peut ni lire ni écrire les données d'un autre
 *   - le jeton Google est hors de portée d'un client authentifié
 *
 * Ce que PGlite ne reproduit pas : le service GoTrue de Supabase. Le schéma
 * `auth` est donc simulé au strict nécessaire, `auth.uid()` lisant un paramètre
 * de session comme le fait l'implémentation réelle avec les claims du JWT.
 */

import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = join(root, 'supabase', 'migrations')

const USER_A = '11111111-1111-1111-1111-111111111111'
const USER_B = '22222222-2222-2222-2222-222222222222'

let passed = 0
const failures: string[] = []

function ok(label: string) {
  passed++
  console.log(`  ok    ${label}`)
}
function fail(label: string, detail: string) {
  failures.push(`${label} : ${detail}`)
  console.log(`  ÉCHEC ${label}`)
  console.log(`        ${detail}`)
}

const db = new PGlite()

/** Vérifie qu'une requête est bien refusée, et pour la bonne raison. */
async function mustReject(label: string, sql: string, expect: RegExp) {
  try {
    await db.exec(sql)
    fail(label, 'la requête a été acceptée alors qu’elle devait échouer')
  } catch (e) {
    const msg = (e as Error).message
    if (expect.test(msg)) ok(label)
    else fail(label, `refusée mais pour une autre raison : ${msg}`)
  }
}

async function mustAccept(label: string, sql: string) {
  try {
    await db.exec(sql)
    ok(label)
  } catch (e) {
    fail(label, (e as Error).message)
  }
}

/** Se place dans la peau d'un utilisateur authentifié donné. */
async function asUser(id: string) {
  await db.exec(`reset role; set request.jwt.claim.sub = '${id}'; set role authenticated;`)
}
async function asAdmin() {
  await db.exec(`reset role;`)
}

// ------------------------------------------------------- simulation de Supabase

await db.exec(`
  create schema if not exists auth;

  create table auth.users (
    id uuid primary key,
    email text
  );

  -- Même logique que l'implémentation Supabase : l'identité vient des claims
  -- du JWT, exposés ici comme paramètre de session.
  create or replace function auth.uid() returns uuid
  language sql stable
  as $fn$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $fn$;

  -- Rôles du client. Non superutilisateurs, donc RLS s'applique réellement.
  create role authenticated nologin;
  create role anon nologin;
  grant usage on schema public to authenticated, anon;
  grant usage on schema auth to authenticated;
  grant execute on function auth.uid() to authenticated;

  -- Droits par défaut de Supabase, reproduits ici parce que leur absence rendait
  -- ce banc d'essai trop indulgent. Supabase accorde execute à anon et à
  -- authenticated nommément, en plus du droit que Postgres accorde à PUBLIC :
  -- une fonction qui ne retire le droit qu'à PUBLIC reste donc appelable en
  -- production, alors qu'elle paraissait fermée ici. Constaté sur le projet réel
  -- avec delete_own_account, que le test local déclarait pourtant hors de portée
  -- d'un visiteur.
  alter default privileges in schema public grant execute on functions to anon, authenticated;
`)

// ------------------------------------------------------------- la migration

console.log('Migration')
const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
if (files.length === 0) {
  console.error('Aucune migration trouvée dans supabase/migrations/')
  process.exit(1)
}
for (const file of files) {
  try {
    await db.exec(readFileSync(join(migrationsDir, file), 'utf8'))
    ok(`${file} appliquée`)
  } catch (e) {
    fail(`${file} appliquée`, (e as Error).message)
    console.log('')
    console.error('La migration ne s’applique pas, les tests suivants sont sans objet.')
    process.exit(1)
  }
}

// Supabase accorde ces droits automatiquement, il faut les reproduire ici.
await db.exec(`
  grant select, insert, update, delete on all tables in schema public to authenticated;
`)

// --------------------------------------------------- déclencheur de profil

console.log('')
console.log('Inscription')
await db.exec(`
  insert into auth.users (id, email) values
    ('${USER_A}', 'a@exemple.fr'),
    ('${USER_B}', 'b@exemple.fr');
`)
{
  const r = await db.query<{ n: number }>(`select count(*)::int as n from profiles`)
  if (r.rows[0].n === 2) ok('un profil est créé automatiquement par utilisateur')
  else fail('un profil est créé automatiquement par utilisateur', `${r.rows[0].n} profils au lieu de 2`)
}

// ------------------------------------------------------------- invariants

console.log('')
console.log('Invariants portés par la base')

await asUser(USER_A)

await mustAccept(
  'une note en clair s’insère',
  `insert into notes (id, title, body) values
     ('aaaaaaaa-0000-0000-0000-000000000001', 'Devis charpente', 'Rappeler l’artisan avant vendredi')`,
)

await mustReject(
  'une note chiffrée refuse un titre en clair',
  `insert into notes (title, is_encrypted, ciphertext)
     values ('fuite', true, 'chiffré')`,
  /encrypted_note_has_no_plaintext/,
)

await mustReject(
  'une note chiffrée sans chiffré est refusée',
  `insert into notes (is_encrypted) values (true)`,
  /encrypted_note_has_no_plaintext/,
)

await mustReject(
  'une note en clair refuse du chiffré résiduel',
  `insert into notes (title, ciphertext) values ('t', 'x')`,
  /encrypted_note_has_no_plaintext/,
)

await mustAccept(
  'une note chiffrée s’insère, son nom de code restant en clair',
  `insert into notes (is_encrypted, ciphertext, is_private, code_name)
     values (true, 'nonce+chiffré', true, 'Basalte')`,
)

// ------------------------------------------- coffre chiffré : clé et éléments

await mustAccept(
  'la clé de données scellée s’enregistre',
  `insert into vault_keys (wrapped_key) values ('nonce+clé scellée')`,
)

// Par mise à jour et non par insertion : la clé étant unique par personne, une
// seconde insertion buterait d'abord sur RLS, et le test dirait alors autre
// chose que ce qu'il prétend vérifier.
await mustReject(
  'une clé scellée vide est refusée',
  `update vault_keys set wrapped_key = '   '`,
  /wrapped_key_not_blank/,
)

await mustAccept(
  'un élément de liste chiffré s’insère sans contenu en clair',
  `insert into checklist_items (note_id, is_encrypted, ciphertext)
     values ('aaaaaaaa-0000-0000-0000-000000000001', true, 'nonce+chiffré')`,
)

await mustReject(
  'un élément chiffré refuse un contenu en clair',
  `insert into checklist_items (note_id, content, is_encrypted, ciphertext)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'fuite', true, 'chiffré')`,
  /encrypted_item_has_no_plaintext/,
)

await mustReject(
  'un élément en clair reste obligé d’avoir un contenu non blanc',
  `insert into checklist_items (note_id, content)
     values ('aaaaaaaa-0000-0000-0000-000000000001', '   ')`,
  /encrypted_item_has_no_plaintext/,
)

await mustReject(
  'un nom de code exige une note masquée',
  `insert into notes (title, code_name) values ('t', 'Basalte')`,
  /code_name_requires_private/,
)

await mustReject(
  'un titre vide est refusé',
  `insert into notes (title) values ('   ')`,
  /title_not_blank/,
)

await mustAccept(
  'un tag s’insère',
  `insert into tags (id, name, color_key) values
     ('bbbbbbbb-0000-0000-0000-000000000001', 'maison', 'ambre')`,
)

await mustReject(
  'deux tags de même nom sont refusés',
  `insert into tags (name, color_key) values ('maison', 'fjord')`,
  /tags_user_id_name_key|duplicate key/,
)

await mustReject(
  'une couleur hors palette est refusée',
  `insert into tags (name, color_key) values ('autre', 'fuchsia')`,
  /invalid input value for enum tag_color/,
)

/*
 * Poser et retirer un tag sur une note, un lien à la fois.
 *
 * C'est la forme exacte de ce qu'écrit `useSetNoteTag`, et elle est ici parce
 * que le remplacement en bloc qu'elle a remplacé — supprimer tous les liens de
 * la note puis les réinsérer — faisait revenir l'ancien tag quand deux gestes
 * se croisaient. Un delta ne peut pas produire ce résultat : deux tags
 * différents sont deux lignes différentes. Reste à vérifier que la base accepte
 * la manœuvre, y compris répétée.
 */
await mustAccept(
  'un tag se pose sur une note',
  `insert into tags (id, name, color_key) values
     ('bbbbbbbb-0000-0000-0000-000000000002', 'sentier', 'fjord');
   insert into note_tags (note_id, tag_id) values
     ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001')`,
)

await mustAccept(
  'reposer le même tag ne casse rien',
  `insert into note_tags (note_id, tag_id) values
     ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001')
   on conflict (note_id, tag_id) do nothing`,
)

{
  await db.exec(`
    insert into note_tags (note_id, tag_id) values
      ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002')
    on conflict (note_id, tag_id) do nothing;
    delete from note_tags
      where note_id = 'aaaaaaaa-0000-0000-0000-000000000001'
        and tag_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  `)
  const r = await db.query<{ tag_id: string }>(
    `select tag_id from note_tags where note_id = 'aaaaaaaa-0000-0000-0000-000000000001'`,
  )
  const restant = r.rows.map((x) => x.tag_id)
  if (restant.length === 1 && restant[0] === 'bbbbbbbb-0000-0000-0000-000000000002') {
    ok('changer de tag ne laisse que le nouveau')
  } else {
    fail('changer de tag ne laisse que le nouveau', `liens restants : ${restant.join(', ') || 'aucun'}`)
  }
  await db.exec(`delete from note_tags where note_id = 'aaaaaaaa-0000-0000-0000-000000000001'`)
}

await mustAccept(
  'un élément de liste s’attache à sa note',
  `insert into checklist_items (id, note_id, content, position) values
     ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Lait', 0)`,
)

await mustReject(
  'un rappel refuse deux cibles',
  `insert into reminders (note_id, checklist_item_id, remind_at) values
     ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', now())`,
  /exactly_one_target/,
)

await mustReject(
  'un rappel refuse de n’avoir aucune cible',
  `insert into reminders (remind_at) values (now())`,
  /exactly_one_target/,
)

await mustAccept(
  'un rappel sur une note s’insère',
  `insert into reminders (note_id, remind_at, google_kind) values
     ('aaaaaaaa-0000-0000-0000-000000000001', now() + interval '1 day', 'event')`,
)

// ------------------------------------------------------------------- RLS

console.log('')
console.log('Isolation entre utilisateurs')

await asUser(USER_B)

{
  const r = await db.query<{ n: number }>(`select count(*)::int as n from notes`)
  if (r.rows[0].n === 0) ok('B ne voit aucune note de A')
  else fail('B ne voit aucune note de A', `${r.rows[0].n} notes visibles`)
}

{
  const r = await db.query<{ n: number }>(`select count(*)::int as n from tags`)
  if (r.rows[0].n === 0) ok('B ne voit aucun tag de A')
  else fail('B ne voit aucun tag de A', `${r.rows[0].n} tags visibles`)
}

await mustReject(
  'B ne peut pas insérer une note au nom de A',
  `insert into notes (user_id, title) values ('${USER_A}', 'usurpation')`,
  /row-level security|violates row-level security policy/,
)

await mustReject(
  'B ne peut pas greffer un élément sur une note de A',
  `insert into checklist_items (note_id, content) values
     ('aaaaaaaa-0000-0000-0000-000000000001', 'intrusion')`,
  /violates foreign key constraint|row-level security/,
)

{
  const r = await db.query(
    `update notes set title = 'détourné' where id = 'aaaaaaaa-0000-0000-0000-000000000001'`,
  )
  if (r.affectedRows === 0) ok('B ne peut pas modifier une note de A')
  else fail('B ne peut pas modifier une note de A', `${r.affectedRows} ligne(s) modifiée(s)`)
}

{
  const r = await db.query(
    `delete from notes where id = 'aaaaaaaa-0000-0000-0000-000000000001'`,
  )
  if (r.affectedRows === 0) ok('B ne peut pas supprimer une note de A')
  else fail('B ne peut pas supprimer une note de A', `${r.affectedRows} ligne(s) supprimée(s)`)
}

// ---------------------------------------------- secret Google hors de portée

console.log('')
console.log('Jeton Google')

await asAdmin()
await db.exec(`
  insert into google_accounts (user_id, google_email, scopes)
    values ('${USER_A}', 'a@exemple.fr', array['tasks']);
  insert into google_credentials (user_id, refresh_token_encrypted)
    values ('${USER_A}', 'secret-chiffré');
`)

await asUser(USER_A)
{
  const meta = await db.query<{ n: number }>(`select count(*)::int as n from google_accounts`)
  if (meta.rows[0].n === 1) ok('A voit les métadonnées de sa connexion Google')
  else fail('A voit les métadonnées de sa connexion Google', `${meta.rows[0].n} ligne(s)`)
}
{
  const cred = await db.query<{ n: number }>(`select count(*)::int as n from google_credentials`)
  if (cred.rows[0].n === 0) ok('A ne voit pas son propre refresh token')
  else fail('A ne voit pas son propre refresh token', `${cred.rows[0].n} ligne(s) lisible(s)`)
}
await mustReject(
  'A ne peut pas écrire dans google_credentials',
  `insert into google_credentials (user_id, refresh_token_encrypted) values ('${USER_A}', 'x')`,
  /row-level security|violates row-level security policy/,
)

// ------------------------------------------------------ réordonnancement

console.log('')
console.log('Réordonnancement des listes')

await asUser(USER_A)
await db.exec(`
  insert into notes (id, kind, title) values
    ('aaaaaaaa-0000-0000-0000-000000000009', 'checklist', 'Courses');
  insert into checklist_items (id, note_id, content, position) values
    ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000009', 'Pain', 0),
    ('dddddddd-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000009', 'Lait', 1),
    ('dddddddd-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000009', 'Café', 2);
`)
{
  // On inverse l'ordre : Café, Pain, Lait.
  await db.exec(`
    select reorder_checklist_items(
      'aaaaaaaa-0000-0000-0000-000000000009',
      array['dddddddd-0000-0000-0000-000000000003',
            'dddddddd-0000-0000-0000-000000000001',
            'dddddddd-0000-0000-0000-000000000002']::uuid[]
    );
  `)
  const r = await db.query<{ content: string; position: number }>(
    `select content, position from checklist_items
     where note_id = 'aaaaaaaa-0000-0000-0000-000000000009' order by position`,
  )
  const order = r.rows.map((x) => x.content).join(',')
  const positions = r.rows.map((x) => x.position).join(',')
  if (order === 'Café,Pain,Lait' && positions === '0,1,2') {
    ok('la fonction applique l’ordre demandé, positions contiguës depuis zéro')
  } else {
    fail(
      'la fonction applique l’ordre demandé, positions contiguës depuis zéro',
      `obtenu ${order} aux positions ${positions}`,
    )
  }
}
{
  // B ne doit pas pouvoir réordonner la liste de A : la fonction s'exécute avec
  // les droits de l'appelant, donc RLS filtre l'update à zéro ligne.
  await asUser(USER_B)
  await db.exec(`
    select reorder_checklist_items(
      'aaaaaaaa-0000-0000-0000-000000000009',
      array['dddddddd-0000-0000-0000-000000000002',
            'dddddddd-0000-0000-0000-000000000001',
            'dddddddd-0000-0000-0000-000000000003']::uuid[]
    );
  `)
  await asUser(USER_A)
  const r = await db.query<{ content: string }>(
    `select content from checklist_items
     where note_id = 'aaaaaaaa-0000-0000-0000-000000000009' order by position`,
  )
  const order = r.rows.map((x) => x.content).join(',')
  if (order === 'Café,Pain,Lait') ok('B ne peut pas réordonner la liste de A')
  else fail('B ne peut pas réordonner la liste de A', `ordre devenu ${order}`)
}

// -------------------------------------------------- recherche et updated_at

console.log('')
console.log('Recherche et horodatage')

await asUser(USER_A)
{
  const r = await db.query<{ n: number }>(
    `select count(*)::int as n from notes
     where search_vector @@ plainto_tsquery('french', 'artisan')`,
  )
  if (r.rows[0].n === 1) ok('la recherche plein texte française trouve la note')
  else fail('la recherche plein texte française trouve la note', `${r.rows[0].n} résultat(s)`)
}
{
  // Le vecteur ne doit contenir que du clair : une note chiffrée n'est pas indexée.
  const r = await db.query<{ n: number }>(
    `select count(*)::int as n from notes where is_encrypted and search_vector <> ''::tsvector`,
  )
  if (r.rows[0].n === 0) ok('une note chiffrée n’alimente pas l’index de recherche')
  else fail('une note chiffrée n’alimente pas l’index de recherche', `${r.rows[0].n} note(s) indexée(s)`)
}
{
  const before = await db.query<{ updated_at: string }>(
    `select updated_at from notes where id = 'aaaaaaaa-0000-0000-0000-000000000001'`,
  )
  await db.exec(
    `update notes set body = 'modifié' where id = 'aaaaaaaa-0000-0000-0000-000000000001'`,
  )
  const after = await db.query<{ updated_at: string }>(
    `select updated_at from notes where id = 'aaaaaaaa-0000-0000-0000-000000000001'`,
  )
  if (after.rows[0].updated_at > before.rows[0].updated_at) ok('updated_at avance à la modification')
  else fail('updated_at avance à la modification', 'la valeur n’a pas changé')
}

// --------------------------------------------- export vers Google Agenda

console.log('')
console.log('Export vers Google Agenda')

await asUser(USER_A)

// Deux notes de travail : une ordinaire, une rangée dans le coffre.
await db.exec(
  `insert into notes (id, title, body) values
     ('aaaaaaaa-0000-0000-0000-0000000000e1', 'Réunion chantier', 'ordre du jour')`,
)
await db.exec(
  `insert into notes (id, title, is_private, code_name) values
     ('aaaaaaaa-0000-0000-0000-0000000000e2', 'Confidentiel', true, 'Grenat')`,
)
// Chiffrée mais hors coffre, pour éprouver les deux protections séparément :
// si le test les cumulait, on ne saurait pas laquelle a fait refuser.
await db.exec(
  `insert into notes (id, is_encrypted, ciphertext) values
     ('aaaaaaaa-0000-0000-0000-0000000000e3', true, 'nonce+chiffré')`,
)

await mustAccept(
  'une note ordinaire s’exporte vers l’agenda',
  `insert into reminders (note_id, remind_at, ends_at, google_kind, google_id)
     values ('aaaaaaaa-0000-0000-0000-0000000000e1',
             now() + interval '1 day', now() + interval '1 day 1 hour', 'event', 'evt_1')`,
)

await mustReject(
  'un créneau qui finit avant de commencer est refusé',
  `insert into reminders (note_id, remind_at, ends_at, google_kind, google_id)
     values ('aaaaaaaa-0000-0000-0000-0000000000e1',
             now() + interval '2 day', now() + interval '1 day', 'event', 'evt_2')`,
  /ends_after_start/,
)

await mustReject(
  'une note du coffre ne part pas vers Google',
  `insert into reminders (note_id, remind_at, ends_at, google_kind, google_id)
     values ('aaaaaaaa-0000-0000-0000-0000000000e2',
             now() + interval '1 day', now() + interval '1 day 1 hour', 'event', 'evt_3')`,
  /chiffrée ou rangée dans le coffre/,
)

await mustReject(
  'une note chiffrée ne part pas vers Google',
  `insert into reminders (note_id, remind_at, ends_at, google_kind, google_id)
     values ('aaaaaaaa-0000-0000-0000-0000000000e3',
             now() + interval '1 day', now() + interval '1 day 1 hour', 'event', 'evt_4')`,
  /chiffrée ou rangée dans le coffre/,
)

// La règle vise l'export, pas le rappel. Une notification locale sur une note
// du coffre ne quitte pas l'appareil, et le nom de code la couvre déjà.
await mustAccept(
  'un rappel purement local reste possible sur une note du coffre',
  `insert into reminders (note_id, remind_at, local_notification_id)
     values ('aaaaaaaa-0000-0000-0000-0000000000e2', now() + interval '1 day', 'notif_1')`,
)

// Le contournement le plus évident : créer l'export, puis ranger la note dans
// le coffre. Le déclencheur tire aussi sur update, mais celui-ci porte sur
// `notes`, pas sur `reminders` — l'export déjà écrit survit donc, et c'est
// l'Edge Function qui refusera d'en créer d'autres. On vérifie au moins que
// l'export ne peut pas être déplacé vers une note protégée après coup.
await mustReject(
  'un export ne peut pas être redirigé vers une note protégée',
  `update reminders set note_id = 'aaaaaaaa-0000-0000-0000-0000000000e2'
     where google_id = 'evt_1'`,
  /chiffrée ou rangée dans le coffre/,
)

await asUser(USER_B)
{
  const vus = await db.query<{ n: number }>(
    `select count(*)::int as n from reminders where google_id = 'evt_1'`,
  )
  if (vus.rows[0].n === 0) ok('B ne voit pas les exports agenda de A')
  else fail('B ne voit pas les exports agenda de A', `${vus.rows[0].n} ligne(s) visible(s)`)
}

await asUser(USER_A)

// ------------------------------------------------- suppression du compte

/**
 * En dernier, et ce n'est pas de la mise en scène : ce bloc efface pour de bon
 * les données de A. Le placer plus haut priverait de leur sujet tous les tests
 * qui suivent.
 */
console.log('')
console.log('Suppression du compte')

await asAdmin()
{
  const r = await db.query<{ peut: boolean; acl: string }>(
    `select has_function_privilege('anon', 'delete_own_account()', 'EXECUTE') as peut,
            coalesce(proacl::text, '(défaut : PUBLIC)') as acl
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'delete_own_account'`,
  )
  if (r.rows[0].peut === false) ok('un visiteur non connecté ne peut pas appeler la suppression')
  else
    fail(
      'un visiteur non connecté ne peut pas appeler la suppression',
      `le droit d’exécution est encore là. Il vient de deux sources, PUBLIC et le ` +
        `grant nommé de Supabase, et il faut retirer les deux. Droits en place : ${r.rows[0].acl}`,
    )
}

// Sans session, l'identité est nulle : la fonction doit le dire plutôt que de
// rendre un succès qui n'a rien supprimé.
await db.exec(`reset role; set request.jwt.claim.sub = ''; set role authenticated;`)
await mustReject(
  'sans session, la suppression est refusée',
  `select delete_own_account()`,
  /Aucune session/i,
)

// Compte des données de B avant, pour prouver ensuite qu'elles n'ont pas bougé.
await asAdmin()
const avantB = await db.query<{ n: number }>(
  `select (select count(*) from notes where user_id = '${USER_B}')
        + (select count(*) from tags where user_id = '${USER_B}') as n`,
)

await asUser(USER_A)
await mustAccept('A supprime son propre compte', `select delete_own_account()`)

await asAdmin()
{
  const r = await db.query<{ table_restante: string; n: number }>(`
    select 'auth.users' as table_restante, count(*)::int as n from auth.users where id = '${USER_A}'
    union all select 'profiles', count(*)::int from profiles where id = '${USER_A}'
    union all select 'notes', count(*)::int from notes where user_id = '${USER_A}'
    union all select 'tags', count(*)::int from tags where user_id = '${USER_A}'
    union all select 'note_tags', count(*)::int from note_tags where user_id = '${USER_A}'
    union all select 'reminders', count(*)::int from reminders where user_id = '${USER_A}'
    union all select 'vault_keys', count(*)::int from vault_keys where user_id = '${USER_A}'
    union all select 'checklist_items', count(*)::int from checklist_items where user_id = '${USER_A}'
  `)
  const restes = r.rows.filter((row) => row.n > 0)
  if (restes.length === 0) ok('la suppression emporte toutes les données du compte, par cascade')
  else
    fail(
      'la suppression emporte toutes les données du compte, par cascade',
      `il reste des lignes dans ${restes.map((row) => `${row.table_restante} (${row.n})`).join(', ')}`,
    )
}
{
  const apresB = await db.query<{ n: number }>(
    `select (select count(*) from notes where user_id = '${USER_B}')
          + (select count(*) from tags where user_id = '${USER_B}') as n`,
  )
  if (apresB.rows[0].n === avantB.rows[0].n)
    ok('le compte voisin est intact — la cascade ne déborde pas')
  else
    fail(
      'le compte voisin est intact — la cascade ne déborde pas',
      `${avantB.rows[0].n} lignes avant, ${apresB.rows[0].n} après`,
    )
}

// ------------------------------------------------------------------ bilan

console.log('')
if (failures.length === 0) {
  console.log(`${passed} vérifications passées.`)
  process.exit(0)
}
console.log(`${passed} passées, ${failures.length} en échec :`)
for (const f of failures) console.log(`  - ${f}`)
process.exit(1)
