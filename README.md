# Cairn

Notes et listes réunies dans une application, avec export des rappels vers Google
Agenda, masquage des contenus privés et classement par tags colorés. Un seul dépôt
produit l'application Android, la PWA web et le widget d'écran d'accueil.

Le plan complet, décisions et arbitrages inclus, vit hors du dépôt dans le fichier
de plan de la session.

## État

Les phases 1 à 3 sont en place. On peut créer, éditer, classer, chercher,
archiver et supprimer des notes et des listes, et en masquer derrière un code.
L'identité visuelle a basculé du registre minéral du Quercy au registre nordique,
palette, typographie, formes, mouvement et iconographie comprises.

| Phase | Contenu | État |
|---|---|---|
| 1 | Ossature, schéma, RLS, authentification, jetons de thème | fait |
| 2 | Notes et listes, tags, filtrage, recherche | fait |
| 3 | Coffre biométrique et noms de code | fait |
| 4 | Notifications locales, export Google Tasks et Calendar | à venir |
| 5 | Widget Android | à venir |
| 6 | Chiffrement bout en bout activable par note | à venir |

## Mise en route

1. Installer les dépendances.

   ```
   npm install
   ```

2. Créer un projet gratuit sur supabase.com, puis récupérer l'URL et la clé anon
   dans Project settings, API.

3. Copier la configuration locale et la remplir.

   ```
   cp .env.example .env
   ```

4. Appliquer le schéma. Les fichiers de `supabase/migrations/` se collent tels
   quels dans l'éditeur SQL du tableau de bord, dans l'ordre de leur nom. Avec la
   CLI Supabase installée, `supabase db push` fait la même chose.

   Sur un projet déjà en service, seules les migrations non encore appliquées
   sont à passer. La dernière, `20260806090000_nordic_tag_colors.sql`, renomme
   les dix clés de couleur de tag et ne réécrit aucune ligne.

5. Pour la connexion Google, voir la section suivante. Rien à configurer côté
   application, les identifiants restent chez Supabase.

6. Lancer.

   ```
   npm run web        # PWA sur navigateur
   npm run android    # émulateur ou appareil
   ```

Sans `.env` rempli, l'application démarre quand même et affiche un écran
expliquant ce qu'il manque, plutôt qu'un écran blanc.

## Connexion Google

L'erreur `redirect_uri_mismatch` vient toujours de la même chose. Google ne
redirige pas vers l'application, il redirige vers Supabase, qui redirige ensuite
vers l'application. Il y a donc deux URL de redirection différentes, à déclarer
dans deux endroits différents.

| Valeur | Où la déclarer | Champ |
|---|---|---|
| `https://<ref>.supabase.co/auth/v1/callback` | Google Cloud Console | Authorized redirect URIs |
| `http://localhost:8081` | Google Cloud Console | Authorized JavaScript origins, développement seulement |
| `http://localhost:8081/callback` | Supabase | Authentication, URL Configuration, Redirect URLs |
| `cairn://callback` | Supabase | Authentication, URL Configuration, Redirect URLs |

`<ref>` est la référence du projet, visible dans son URL de tableau de bord. La
valeur exacte est aussi affichée par Supabase sur la page du fournisseur Google,
prête à copier.

Le type de client OAuth doit être « Web application », pas « Android », même en
ciblant Android. La redirection part vers l'endpoint HTTPS de Supabase, et un
client de type Android n'a pas de champ de redirection.

Deux causes plus discrètes du même message. Google compare la chaîne caractère
pour caractère, donc une barre oblique finale en trop suffit à faire échouer la
comparaison. Et une modification côté Google met parfois quelques minutes à se
propager.

## Mot de passe oublié

Le lien reçu par courriel ne fonctionne que dans le navigateur qui l'a demandé.
Ce n'est pas un défaut : le client est en `flowType: 'pkce'`, la demande dépose
un vérificateur dans le stockage local, et seul ce navigateur peut échanger le
code contre une session. Demander depuis l'ordinateur puis ouvrir le lien sur le
téléphone échoue silencieusement — on retombe sur l'écran de connexion, sans
message. À dire aux utilisateurs plutôt qu'à corriger : l'alternative, le flux
implicite, laisse les jetons dans l'URL.

Le lien ouvre une vraie session avant que le mot de passe soit choisi. La
navigation est donc retenue sur `/new-password` jusqu'à ce qu'il le soit, et
cette retenue survit au rechargement : `PASSWORD_RECOVERY` n'est annoncé qu'une
fois, à l'échange du code, d'où une marque écrite dans le stockage
(`cairn.recuperation-en-cours`). Sans elle, un simple F5 emmenait dans les notes
et le mot de passe oublié le restait.

Le serveur de courriel intégré de Supabase plafonne les envois à quelques-uns
par heure, pour tout le projet. En développement on l'atteint vite ; l'écran
l'annonce alors en français. Un SMTP personnalisé lève ce plafond.

## Suppression du compte

Réglages, section Compte. Il faut recopier l'adresse du compte : un second
bouton se clique du même geste que le premier, recopier l'adresse oblige à la
lire, donc à savoir lequel disparaît.

Une seule ligne est supprimée, celle d'`auth.users`. Tout le reste suit par
cascade — les tables de l'application comme celles du schéma `auth` de Supabase.
Rien à tenir à jour ici quand une table s'ajoutera, à condition qu'elle cascade
comme les autres ; une liste d'ordres `DELETE` aurait vieilli en silence.

L'appel passe par `delete_own_account()`, en droits du définisseur parce que
`auth` est hors de portée du rôle client. Le pouvoir emprunté est borné à une
ligne : `auth.uid()` est lu dans la fonction et n'est pas un paramètre.

Le client efface ensuite ce qui dort sur l'appareil — code du coffre, clé de
données, cache persisté. **Le serveur d'abord, l'appareil ensuite** : si l'appel
échoue, la clé est encore là et le compte reste utilisable. Dans l'autre sens, un
échec laisserait un compte vivant dont les notes chiffrées seraient devenues
illisibles.

Deux sources accordent `execute` sur une fonction du schéma `public` : PUBLIC,
par défaut Postgres, et un `alter default privileges` de Supabase qui l'accorde
nommément à `anon`, `authenticated` et `service_role`. **Retirer l'une laisse
l'autre debout.** `npm run db:test` reproduit désormais ces droits par défaut,
sans quoi il déclarait fermée une fonction ouverte en production.

## Commandes

| Commande | Rôle |
|---|---|
| `npm run web` | serveur de développement, cible navigateur |
| `npm run android` | serveur de développement, cible Android |
| `npm run build:web` | export statique de la PWA, pour Cloudflare Pages |
| `npm run theme` | régénère `generated/` depuis `src/ui/theme.ts` |
| `npm run theme:check` | échoue si `generated/` a dérivé de la source |
| `npm run theme:contrast` | rapport de contraste WCAG des deux thèmes |
| `npm run db:test` | rejoue les migrations et leurs invariants sur PGlite |
| `npm run test:logic` | teste la composition, le filtrage, la recherche, la grille et les règles du coffre |
| `npm run typecheck` | TypeScript sans émission |
| `npm run verify` | enchaîne les quatre vérifications ci-dessus |

## Deux mécanismes à connaître avant de toucher au code

### Les couleurs ont une source unique

`src/ui/theme.ts` fait autorité. `npm run theme` en dérive `generated/theme.json`
pour l'application et `app.config.ts`, la feuille de style de la PWA, et les
ressources de couleurs du widget Android. Rien ne se recopie à la main, donc les
trois surfaces ne peuvent pas diverger.

Le script mesure aussi le contraste des deux thèmes et refuse d'écrire si une
paire texte sur fond tombe sous les seuils WCAG AA. Les valeurs actuelles ne sont
pas un choix à l'œil, elles sont issues d'une résolution sous contrainte : les
modifier sans relancer `npm run theme:contrast` casse très probablement
l'accessibilité.

Une couleur de tag est stockée par clé (`ambre`), jamais en hexadécimal. C'est ce
qui permet au thème clair de réinterpréter la palette. Ces clés sont aussi les
valeurs du type `tag_color` en base : les renommer demande une migration, la
dernière en date est `20260806090000_nordic_tag_colors.sql`.

### L'identité est nordique, et les runes ne veulent rien dire

La pierre levée du Nord plutôt que le calcaire du Quercy : gris froids autour de
200° de teinte, aurore boréale en accent, angles taillés au ciseau plutôt
qu'arrondis, et un mouvement frappé plutôt que posé. Viking pour les capitales
gravées, Junicode pour la lecture, Archivo pour les commandes. Les deux
premières sont embarquées dans `assets/fonts`, licence à côté de chaque
fichier — Viking sous licence 1001fonts, Junicode sous SIL Open Font.

Les runes de `src/ui/runes.tsx` sont ornementales et le restent. Une rune ne
remplace jamais une icône qu'il faut comprendre pour agir : la case à cocher
reste une case à cocher, la corbeille garde son icône de corbeille. Elles sont
toutes masquées aux lecteurs d'écran, et le logotype affiche le nom écrit
au-dessus de sa translittération ᚲᚨᛁᚱᚾ, jamais à sa place.

Elles sont tracées en vectoriel et non écrites en Unicode : le bloc Runique
(U+16A0 à U+16FF) n'est couvert par presque aucune police système, un caractère
runique posé dans un `Text` afficherait un rectangle vide sur la majorité des
appareils.

### Le coffre masque, il ne chiffre pas

C'est la phrase à retenir avant d'y ranger quoi que ce soit, et l'application la
dit elle-même sur l'écran de configuration. Une note du coffre disparaît de la
grille et ne revient que derrière un code, mais elle reste en clair dans
Postgres, gardée par RLS comme toutes les autres. La menace visée est quelqu'un
qui regarde ton écran ou qui prend ton téléphone déverrouillé, pas quelqu'un qui
accède à la base. Ce niveau-là, c'est la phase 6.

Trois conséquences dans le code.

Le nom de code remplace le titre partout où la note est listée, et une note du
coffre sans nom de code n'affiche **rien** plutôt que son titre. Un repli sur le
titre serait invisible à l'usage et laisserait fuir exactement ce qu'on cachait.

Les notes masquées vivent dans une clé de requête distincte, volatile, et leurs
éléments de liste aussi. Refermer le coffre ne masque pas une vue, cela laisse
expirer les données du cache. Sans la seconde clé, les cases à cocher des notes
masquées descendraient dans le cache persisté par la bande.

Le code n'est pas dérivé par PBKDF2, et c'est délibéré. Un secret de quatre
chiffres se parcourt entièrement en une fraction de seconde quel que soit le
nombre d'itérations, alors que chaque itération coûte un passage du pont natif.
Ce qui protège un code court, c'est le nombre d'essais : la temporisation de
`src/vault/policy.ts` est gratuite trois fois, puis double à chaque échec et
plafonne à cinq minutes. Elle est testée sous Node, y compris le cas où le bon
code est refusé parce que l'attente court encore.

Le coffre se referme au passage en arrière-plan, cinq minutes après son
ouverture, et en quittant l'écran. Si une note du coffre était ouverte au moment
de la fermeture, l'éditeur l'annonce au lieu de prétendre que la note a été
supprimée ailleurs.

Le secret vit dans le Keystore Android via `expo-secure-store`. Sur le web, ce
module n'existe pas et le secret retombe dans `localStorage`, donc lisible par
n'importe quel script de l'origine. C'est écrit à l'utilisateur sur l'écran de
configuration quand il est sur le web, pas seulement ici.

### La recherche est côté client, et c'est un choix

Toutes les notes visibles sont déjà en cache, donc interroger `search_vector`
côté Postgres ajouterait un aller-retour réseau pour un résultat identique, en
moins bon : latence à chaque frappe et échec hors ligne. La recherche filtre donc
le cache, avec repli d'accents pour que « cafe » trouve « café ».

L'index GIN de la migration n'est pas inutile pour autant. Il devient nécessaire
le jour où le corpus dépasse ce qu'on garde raisonnablement en cache et où la
liste sera paginée. Ce jour-là, le filtre client devient le repli hors ligne et
la requête serveur passe devant.

### Une note laissée vide est écartée en sortant

Ouvrir un bouton de création puis revenir en arrière sans rien écrire ne laisse
aucun résidu : la note est supprimée définitivement en quittant l'éditeur, comme
le fait Google Keep. Il n'y a rien à récupérer, et remplir la corbeille de
coquilles vides n'aiderait personne.

« Vide » veut dire sans titre, sans corps, sans élément de liste, sans tag et sans
couleur. Teinter une note ou lui poser un tag est une intention explicite, donc
elle est conservée même sans texte. Le verdict est calculé sur l'état local de la
saisie et non sur la note du serveur, qui peut être en retard de 600 millisecondes
sur la frappe.

### Ce qui n'est pas persisté sur le disque

Le cache de requêtes descend dans le stockage local, mais pas en entier. Sur le
web, ce stockage est lisible par n'importe quel script de l'origine, donc le
coffre et la corbeille restent en mémoire seulement. C'est aussi la raison pour
laquelle les notes masquées vivent dans une clé de requête distincte plutôt que
dans la liste principale filtrée à l'affichage : la séparation est structurelle.

### Les invariants vivent dans la base

Une note chiffrée ne peut pas contenir de titre en clair, un rappel ne peut pas
viser deux cibles à la fois, un élément de liste ne peut pas être rattaché à la
note d'un autre utilisateur. Ce sont des contraintes SQL et des clés étrangères
composites, pas des règles que le code applicatif devrait se rappeler de
respecter.

`npm run db:test` le prouve sur du vrai Postgres, compilé en WebAssembly, donc
sans Docker ni projet distant. Il vérifie aussi l'isolation entre deux
utilisateurs et le fait que le jeton Google reste hors de portée d'un client
authentifié.

## Structure

```
app/                    routes expo-router, partagées Android et web
  +html.tsx             document de la PWA, script anti-flash de thème
  (auth)/               connexion et inscription
  (tabs)/               zone authentifiée
src/
  auth/                 session Supabase et actions d'authentification
  db/                   client Supabase, types du schéma, stockage clé-valeur
  ui/theme.ts           source unique des couleurs, de la typographie et des formes
  ui/components.tsx     primitives d'interface
  ui/runes.tsx          futhark tracé en vectoriel, ornemental
  vault/policy.ts       règles du coffre, sans plateforme, testées sous Node
  vault/secret.ts       stockage du code sur l'appareil et dérivation
scripts/                génération de thème, tests de schéma
supabase/migrations/    schéma SQL et politiques RLS
generated/              artefacts dérivés du thème, à committer
```
