# Cairn

Notes and checklists in one app, with reminders exported to Google Calendar,
private contents hidden behind a passcode, and colour-coded tags. A single
repository produces the Android app, the web PWA and the home screen widget.

**Just want the app on your phone?** See [INSTALL.md](INSTALL.md). This file is
for people who want to run or change the code.

The full plan, decisions and trade-offs included, lives outside the repository in
the session's plan file.

## Status

Phases 1 to 5 are in place. You can create, edit, organise, search, archive and
delete notes and checklists, and hide some behind a passcode.

| Phase | Contents | Status |
|---|---|---|
| 1 | Skeleton, schema, RLS, authentication, theme tokens | done |
| 2 | Notes and checklists, tags, filtering, search | done |
| 3 | Biometric vault and code names | done |
| 4 | Local notifications, Google Tasks and Calendar export | Calendar export done, the rest to come |
| 5 | Android widget | done |
| 6 | Per-note end-to-end encryption | to come |

## Getting started

1. Install the dependencies.

   ```
   npm install
   ```

2. Create a free project on supabase.com, then take the URL and the anon key from
   Project settings, API.

3. Copy the local configuration and fill it in.

   ```
   cp .env.example .env
   ```

4. Apply the schema, through the CLI:

   ```
   supabase link --project-ref <project-ref>
   supabase db push
   ```

   `supabase/config.toml` is what makes this repository a project the CLI will
   link. Only the migrations not yet applied are run.

   The dashboard's SQL editor accepts the same files, in filename order, and it
   is a reasonable way to bring up a brand new empty project. It is not the same
   thing, and the difference is worth knowing: **a run through the editor leaves
   no trace** in `supabase_migrations.schema_migrations`, the ledger the CLI
   reads. Nothing can afterwards tell an applied migration from a missing one.
   That is how two migrations went missing here, one of them silently for days,
   until the app stopped reading anything at all with `column notes.position does
   not exist` ([#20](https://github.com/oschweitzer/cairn/issues/20)).

   To know where a database stands:

   ```
   supabase migration list
   ```

   Local and remote side by side, one line each. Every file marked applied on
   both sides, and nothing on the remote that is not a file here, is what a
   healthy project looks like.

   When the two disagree — a version on the remote that matches no file, or a
   file the remote has never heard of although the schema plainly holds it —
   `supabase migration repair --status applied <version>` sets the ledger
   straight without touching the schema. It states what has already run, so it is
   only ever right when the database really does hold that migration; check
   before claiming it.

5. For Google sign-in, see the next section. Nothing to configure on the app
   side; the credentials stay with Supabase.

6. Run it.

   ```
   npm run web        # PWA in a browser
   npm run android    # development build on an emulator or device
   ```

   Since the widget landed, the Android app carries native code of its own and no
   longer runs inside Expo Go: `npm run android` builds a development version.
   The web target is unaffected.

Without a filled-in `.env`, the app still starts and shows a screen explaining
what is missing, rather than a blank page.

## Google sign-in

The `redirect_uri_mismatch` error always comes from the same thing. Google does
not redirect to the app, it redirects to Supabase, which then redirects to the
app. So there are two different redirect URLs, to be declared in two different
places.

| Value | Where to declare it | Field |
|---|---|---|
| `https://<ref>.supabase.co/auth/v1/callback` | Google Cloud Console | Authorized redirect URIs |
| `http://localhost:8081` | Google Cloud Console | Authorized JavaScript origins, development only |
| `http://localhost:8081/callback` | Supabase | Authentication, URL Configuration, Redirect URLs |
| `cairn://callback` | Supabase | Authentication, URL Configuration, Redirect URLs |

`<ref>` is the project reference, visible in its dashboard URL. The exact value
is also shown by Supabase on the Google provider page, ready to copy.

A redirect landing on `http://localhost:3000` always says the same thing, and it
is never the port you think you are reading: 3000 is a Supabase project's factory
Site URL, the one it falls back to when the requested URL is not in the Redirect
URLs. So the symptom points at a missing entry in that list, not at a server to
start. On mobile, the entry in question is `cairn://callback`. That same Site URL
feeds the `{{ .SiteURL }}` of the email templates: leaving it at its factory
value also sends confirmation links to that phantom port.

The OAuth client type has to be "Web application", not "Android", even when
targeting Android. The redirect goes to Supabase's HTTPS endpoint, and an
Android-type client has no redirect field.

Two quieter causes of the same message. Google compares the string character by
character, so one trailing slash too many is enough to fail the comparison. And a
change on Google's side sometimes takes a few minutes to propagate.

### Google sign-in does not work in Expo Go

That is expected, and it cannot be fixed in code. Expo Go is an already-published
app carrying its own scheme: the `scheme: 'cairn'` declared in `app.config.js`
does not exist in the binary being run. `makeRedirectUri` knows this and returns
the development server's address, `exp://192.168.x.x:8081/--/callback`, instead
of `cairn://callback`.

That address is not in the Supabase project's allow list — it cannot be, the IP
changes from network to network. So Supabase refuses the redirect and falls back
to the project's site URL, `http://localhost:8081`. The phone then opens a
localhost that, on the phone, hosts nothing. Hence the dead page.

The way out is to run a real binary, which carries the `cairn://` scheme for
real. Next section.

## Android app

Two profiles in `eas.json`, for two uses.

| Profile | What you get | When |
|---|---|---|
| `preview` | Standalone, installable APK with the bundle embedded | Trying the app for real, handing it to someone |
| `development` | APK that connects to the Metro server, fast refresh kept | Developing with Google sign-in actually working |

The build runs on Expo's servers: neither Java nor the Android SDK is needed on
your machine. A free account on expo.dev is.

1. Install the CLI and sign in.

   ```
   npm install --global eas-cli
   eas login
   ```

2. Attach the folder to an EAS project.

   ```
   eas init
   ```

   The command creates the project on expo.dev then prints an id. It cannot write
   it itself: `app.config.js` is a dynamic configuration, which a tool cannot
   modify without risking the loss of its logic. Copy it by hand into
   `app.config.js`, next to `experiments`, then commit.

   ```js
   extra: {
     eas: { projectId: '<id printed by eas init>' },
   },
   ```

3. Put the Supabase keys on the EAS side. This is the step that gets forgotten:
   `.env` is git-ignored, and EAS Build only uploads tracked files. Without it the
   build succeeds and the app opens on the configuration screen, which looks like
   a failure when only two variables are missing.

   ```
   eas env:set --name EXPO_PUBLIC_SUPABASE_URL --value "https://<ref>.supabase.co" --environment preview --visibility plaintext
   eas env:set --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<anon key>" --environment preview --visibility plaintext
   ```

   `plaintext` is the right level: both values ship inside the bundle anyway, and
   it is RLS that protects the data. Repeat with `--environment development` and
   `--environment production` for whichever profiles you use.
   `eas env:list --environment preview` checks.

   For the calendar export, two more variables, also public:

   ```
   eas env:set --name EXPO_PUBLIC_WEB_URL --value "https://<domain>" --environment preview --visibility plaintext
   eas env:set --name EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB --value "<Web client id>" --environment preview --visibility plaintext
   ```

4. Build, then install.

   ```
   eas build --platform android --profile preview
   ```

   The command returns a download URL and a QR code. Opening the QR from the
   phone downloads the APK; Android will ask you to allow installing from that
   source. With `adb` at hand, `eas build:run -p android --latest` puts the file
   on the connected device.

No signing key to make: on the first Android build, EAS generates one and keeps
it. Keeping it is what will later allow publishing an update of the same package,
`app.cairn`.

### Builds from CI

`.github/workflows/android.yml` does both of the above without anyone typing a
command.

| Trigger | What happens |
|---|---|
| merge to `main` | an EAS build is started and not waited on — a fresh internal link, about a minute of runner time |
| push of a `v*` tag | the same build, waited on, the APK downloaded and attached to a GitHub Release |

A Release on every merge would be noise, and `appVersionSource: "remote"` means
each build spends a version code whether or not anyone installs it. So tagging is
the deliberate act:

```
git tag v0.2.0 && git push origin v0.2.0
```

The workflow needs one secret, `EXPO_TOKEN` (expo.dev ▸ Account settings ▸ Access
tokens), in Settings ▸ Secrets and variables ▸ Actions. The Supabase URL and anon
key are not needed: they live in EAS environment variables, and `eas build` reads
them there, so they never enter the workflow. Without the token, the merge job
says so and stops rather than failing red on every merge.

The APK is deliberately **not** built on the runner. `expo prebuild` plus
`./gradlew assembleRelease` would sign with a keystore generated on the spot, and
`public/.well-known/assetlinks.json` commits the certificate's SHA-256 while the
Google OAuth Android client is registered against that same fingerprint: App
Links would stop verifying and Google sign-in would stop working, in a build that
installs and looks fine. EAS holds the keystore.

Then check that `cairn://callback` really is in the Supabase project's Redirect
URLs — that entry, and only it, is what makes Google sign-in succeed from the
APK.

The `development` profile needs one more dependency,
`npx expo install expo-dev-client`, and is then launched with
`npx expo start --dev-client`.

## Home screen widget

The Android widget lives in `modules/cairn-widget`, a local Expo module: Kotlin,
`RemoteViews` layouts, and a bridge exposing two functions to JavaScript. It
renders neither on the web nor in Expo Go, so checking it needs a native build.

Its design and its trade-offs are documented in
[`src/widget/README.md`](src/widget/README.md) — in particular why it reads a
local snapshot rather than talking to Supabase, and why nothing from the vault
goes into that snapshot by default.

## Deploying the PWA

On Netlify, project `cairn-notes`, served at
**https://cairn-notes.netlify.app**. The `netlify.app` subdomain is included in
the free plan: no domain name to buy. `cairn` on its own was already taken —
names are unique across all of Netlify, not just within an account.

`netlify.toml` carries three things that are not obvious.

**The build command and the Node version.** The build runs at Netlify's, not
locally. `NODE_VERSION` is pinned to 22 because react-native 0.86 requires
`^20.19.4 || ^22.13.0 || ^24.3.0` and Netlify's default version moves without
warning.

**The note link rewrite.** expo-router's static export writes the dynamic route
under its literal name, `note/[id].html`. Without a rule, opening
`/note/<id>` would return a 404 — which is precisely the links dropped into
Google Calendar events. The rule is status 200, a rewrite and not a redirect: the
address stays intact in the browser's bar, and the router reads the id from it on
the first render.

**The MIME type of `assetlinks.json`.** Android requires `application/json`;
served otherwise, App Links verification fails silently.

### Environment variables live at Netlify

`.env` is not tracked by git and therefore never reaches the build. The three
public keys have to be declared in the project settings, "builds" scope:

| Variable | Value |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | the Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | the anon key |
| `EXPO_PUBLIC_WEB_URL` | `https://cairn-notes.netlify.app` |

Without them the build still succeeds and publishes an app that opens on its
configuration screen. That is deliberate — a screen explaining what is missing
beats a blank page — but it looks like a failure when only a variable is missing.

### Production follows `main`

The Netlify project is linked to this repository: every push to `main` builds and
publishes, and every pull request gets its own deploy preview. Nobody uploads a
build by hand, and nobody should — that is how the live site once ended up
twenty-three commits behind, serving an app whose links, formatting and
drag-to-reorder had been announced in the changelog months before they were ever
deployed. A manual upload leaves `commit_ref: null` in the deploy's metadata: the
site then has no way of telling anyone which code it is running.

Linking is done once, in the Netlify project ▸ Project configuration ▸ Build &
deploy ▸ Continuous deployment ▸ **Link repository**, with `main` as the
production branch and deploy previews left on. The build itself needs nothing new
— `netlify.toml` already pins the command, the publish directory, the Node
version, the `/note/*` rewrite and the headers — but the three environment
variables above must be set in the project, since `.env` is untracked and never
reaches Netlify.

The CLI stays available for an emergency, and only for that:

```bash
npx -y @netlify/mcp@latest --site-id <project id>
```

## Google Calendar

From a note or a checklist, the calendar button in the bottom bar opens a panel:
date, time, duration, and the event goes into the main calendar of the authorised
Google account.

**What is sent: the note's title and a link to it. Nothing else.** Not the body,
not the checkable items. The event points at `https://<domain>/note/<id>`; on a
phone where Cairn is installed, Android opens the app directly thanks to the App
Links declared above, and elsewhere the link opens the PWA.

### Protected notes do not go

A note that is encrypted or filed in the vault has no calendar button, and will
not get one. Sending its title to Google would undo the promise of encryption,
and undo it quietly — nothing in the calendar would recall where the line came
from.

This refusal holds at three depths, and the redundancy is deliberate: the
interface hides the button, the Edge Function re-reads the note before any call
to Google, and a database trigger refuses the row whatever happens. The first two
avoid pointless work; only the third holds if the client is bypassed, or if the
note is filed into the vault while the send is in flight. The `npm run db:test`
suite covers all three cases, including an attempt to redirect an existing export
towards a protected note.

### Google console

**A single OAuth client**, of type "Web", for the APK as well as for the PWA.

An "Android" client seemed the obvious choice for the APK. It was tried, and
Google refused it: *"Custom URI scheme is not enabled for your Android client"*,
its documentation adding that "custom URI schemes are no longer supported on
Android". So the redirect can no longer be `cairn://` or `app.cairn:/`. The route
Google pushes is App Links: an ordinary `https://` address that Android hands to
the installed app rather than to the browser, because the domain and the app
recognise each other through `/.well-known/assetlinks.json`.

Both platforms therefore share the same return address, and so the same client,
which simplifies everything — one id, one secret, no branching.

| Web client field | Value |
|---|---|
| Authorized JavaScript origins | `https://<domain>` |
| Authorized redirect URIs | `https://<domain>/google` |

**A consequence not to miss**: on Android, `npm run assetlinks` is no longer a
convenience. Without a verified file, the consent return opens in the browser and
the app waits for a code that will never come back to it. Calendar sign-in from
the APK depends on it entirely.

Remember also to enable **Google Calendar API** under APIs & Services → Library,
and to add yourself as a *test user* while the project is in test mode.

The scope to add to the consent screen is
`https://www.googleapis.com/auth/calendar.events`. Google classes it as
sensitive: while the project stays in test mode it is capped at a hundred
accounts and authorisations expire **after seven days**. That is the reason
`refresh_expires_at` and `needs_reauth` exist — the deadline is shown in the
settings, and the reconnect banner appears by itself rather than letting you
discover the break at the moment you send a note.

This authorisation is separate from signing in to Cairn. Signing in with Google
grants no calendar access, and revoking calendar access signs you out of nothing.

### Edge Function secrets

The refresh token never passes through the device: the three Edge Functions do
the exchange and keep it encrypted in `google_credentials`, a table with RLS
enabled and no policy at all. They need this:

```
supabase secrets set GOOGLE_CLIENT_ID_WEB=... GOOGLE_CLIENT_SECRET_WEB=... CAIRN_WEB_URL=https://<domain> GOOGLE_TOKEN_KEY=$(openssl rand -hex 32)
```

`GOOGLE_TOKEN_KEY` is the AES-GCM key that encrypts the token in the database. It
protects against a leak of the database alone, not against the server itself —
claiming otherwise would misrepresent the guarantee, and
`supabase/functions/_shared/chiffrement.ts` says so in as many words. **Changing
it makes existing connections unreadable**: everyone will have to re-authorise,
which the app asks for by itself.

Deployment:

```bash
supabase functions deploy google-connect google-disconnect calendar-event
```

### On the app side

Two values in `.env`, both public: `EXPO_PUBLIC_WEB_URL` and
`EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB`. Without them the "Google Calendar" card in
settings does not appear, and the panel explains what is missing rather than
offering a button that would fail on the first click.

The Edge Functions are Deno, not React Native: they are excluded from
`tsconfig.json` and are checked with `deno check` from `supabase/functions/`,
where a `deno.json` configures them. Leaving them in the app's typecheck would
make it fail on `Deno` and on `npm:` imports, which are perfectly correct where
they live.

## Forgotten password

The link received by email only works in the browser that requested it. This is
not a defect: the client is in `flowType: 'pkce'`, the request leaves a verifier
in local storage, and only that browser can exchange the code for a session.
Requesting from the computer then opening the link on the phone fails silently —
you land back on the sign-in screen, with no message. Something to tell users
rather than to fix: the alternative, the implicit flow, leaves tokens in the URL.

The link opens a real session before the password has been chosen. Navigation is
therefore held on `/new-password` until it is, and that hold survives a reload:
`PASSWORD_RECOVERY` is announced only once, at the code exchange, hence a marker
written to storage (`cairn.recuperation-en-cours`). Without it, a simple refresh
took you into the notes and the forgotten password stayed forgotten.

Supabase's built-in mail server caps sending at a few per hour, for the whole
project. In development you hit that quickly; the screen then says so, in French.
A custom SMTP lifts the cap.

## Deleting an account

Settings, Account section. You have to retype the account's address: a second
button is clicked with the same gesture as the first, whereas retyping the
address forces you to read it, and therefore to know which one is disappearing.

A single row is deleted, the one in `auth.users`. Everything else follows by
cascade — the app's tables as well as those of Supabase's `auth` schema. Nothing
to maintain here when a table is added, provided it cascades like the others; a
list of `DELETE` statements would have aged silently.

The call goes through `delete_own_account()`, in definer rights because `auth` is
out of reach of the client role. The borrowed power is bounded to one row:
`auth.uid()` is read inside the function and is not a parameter.

The client then wipes what sleeps on the device — vault passcode, data key,
persisted cache. **Server first, device second**: if the call fails, the key is
still there and the account remains usable. The other way round, a failure would
leave a living account whose encrypted notes had become unreadable.

Two sources grant `execute` on a function in the `public` schema: PUBLIC, by
Postgres default, and a Supabase `alter default privileges` that grants it by
name to `anon`, `authenticated` and `service_role`. **Removing one leaves the
other standing.** `npm run db:test` now reproduces those default grants, without
which it declared closed a function that was open in production.

## Commands

| Command | Role |
|---|---|
| `npm run web` | development server, browser target |
| `npm run android` | development build, Android target |
| `npm run build:web` | static export of the PWA, into dist/ |
| `npm run assetlinks` | writes public/.well-known/assetlinks.json from .env |
| `npm run theme` | regenerates `generated/` from `src/ui/theme.ts` |
| `npm run theme:check` | fails if the derived resources have drifted from the source |
| `npm run theme:contrast` | WCAG contrast report for both themes |
| `npm run db:test` | replays the migrations and their invariants on PGlite |
| `npm run test:logic` | tests composition, filtering, search, the grid, markup and the vault rules |
| `npm run typecheck` | TypeScript with no emit |
| `npm run verify` | chains the four checks above |

## Two mechanisms to know before touching the code

### Colours have a single source

`src/ui/theme.ts` is authoritative. `npm run theme` derives from it
`generated/theme.json` for the app and `app.config.js`, the PWA's stylesheet, and
the Android widget's colour resources. Nothing is copied by hand, so the three
surfaces cannot drift apart.

The script also measures the contrast of both themes and refuses to write when a
text-on-background pair falls below the WCAG AA thresholds. The current values
are not an eyeballed choice, they come out of a constrained solve: changing them
without re-running `npm run theme:contrast` very probably breaks accessibility.

A tag colour is stored by key (`ambre`), never as hexadecimal. That is what lets
the light theme reinterpret the palette. Those keys are also the values of the
`tag_color` type in the database: renaming them takes a migration, the most
recent being `20260806090000_nordic_tag_colors.sql`.

### The identity is Nordic, and the runes mean nothing

The standing stone of the North rather than the limestone of the Quercy: cold
greys around 200° of hue, aurora borealis as the accent, chisel-cut angles rather
than rounded ones, and a struck rather than settled sense of motion. Viking for
engraved capitals, Junicode for reading, Archivo for controls. The first two are
bundled in `assets/fonts`, with a licence beside each file — Viking under the
1001fonts licence, Junicode under SIL Open Font.

The runes in `src/ui/runes.tsx` are ornamental and stay that way. A rune never
replaces an icon you have to understand in order to act: the checkbox stays a
checkbox, the trash keeps its trash icon. They are all hidden from screen
readers, and the logotype shows the written name above its transliteration
ᚲᚨᛁᚱᚾ, never in its place.

They are drawn as vectors rather than written in Unicode: the Runic block (U+16A0
to U+16FF) is covered by almost no system font, and a runic character placed in a
`Text` would show an empty rectangle on most devices.

### The vault hides, it does not encrypt

That is the sentence to remember before filing anything in it, and the app says
so itself on the setup screen. A vault note disappears from the grid and only
comes back behind a passcode, but it stays in the clear in Postgres, guarded by
RLS like all the others. The threat it addresses is someone looking at your
screen or picking up your unlocked phone, not someone reaching the database. That
level is phase 6.

Three consequences in the code.

The code name replaces the title everywhere the note is listed, and a vault note
with no code name displays **nothing** rather than its title. Falling back to the
title would be invisible in use and would leak exactly what was being hidden.

Hidden notes live in a separate, volatile query key, and so do their checklist
items. Closing the vault does not hide a view, it lets the cached data expire.
Without the second key, the checkboxes of hidden notes would slip into the
persisted cache sideways.

The passcode is not derived through PBKDF2, and that is deliberate. A four-digit
secret is exhausted in a fraction of a second whatever the iteration count, while
each iteration costs a crossing of the native bridge. What protects a short code
is the number of attempts: the delay in `src/vault/policy.ts` is free three
times, then doubles on each failure and caps at five minutes. It is tested under
Node, including the case where the right code is refused because the wait is
still running.

The vault closes after five minutes without a gesture — a touch, a scroll, a
click, a keystroke. Time spent in another app or another tab counts as idle time
rather than suspending the count, so coming back after ten seconds finds it open
and coming back after six minutes finds it closed. What that gives up is stated
where it is implemented: a phone picked up while Cairn sits in the background has
whatever is left of the five minutes. What it buys is a vault worth locking, one
that does not ask for the code ten times an hour until the owner picks a shorter
one. If a vault note was open at closing time, the editor says so instead of
pretending the note was deleted elsewhere.

The secret lives in the Android Keystore through `expo-secure-store`. On the web
that module does not exist and the secret falls back to `localStorage`, and so is
readable by any script on the origin. That is written to the user on the setup
screen when they are on the web, not only here.

### Search is client-side, and that is a choice

Every visible note is already cached, so querying `search_vector` on the Postgres
side would add a network round trip for an identical result, only worse: latency
on every keystroke and failure offline. So search filters the cache, with accent
folding so that "cafe" finds "café".

The migration's GIN index is not useless for all that. It becomes necessary the
day the corpus outgrows what can reasonably be cached and the list is paginated.
On that day the client filter becomes the offline fallback and the server query
moves in front.

### A note left empty is discarded on the way out

Opening a create button then going back without writing anything leaves no
residue: the note is permanently deleted on leaving the editor, as Google Keep
does. There is nothing to recover, and filling the trash with empty shells would
help nobody.

"Empty" means no title, no body, no checklist item, no tag and no colour. Tinting
a note or putting a tag on it is an explicit intent, so it is kept even without
text. The verdict is computed on the local state of the input and not on the
server's note, which can be 600 milliseconds behind the typing.

### What is not persisted to disk

The query cache goes down into local storage, but not all of it. On the web that
storage is readable by any script on the origin, so the vault and the trash stay
in memory only. That is also why hidden notes live in a separate query key rather
than in the main list filtered at display time: the separation is structural.

### Invariants live in the database

An encrypted note cannot hold a plaintext title, a reminder cannot aim at two
targets at once, a checklist item cannot be attached to another user's note.
These are SQL constraints and composite foreign keys, not rules the application
code would have to remember to respect.

`npm run db:test` proves it against real Postgres, compiled to WebAssembly, so
without Docker or a remote project. It also checks isolation between two users
and that the Google token stays out of reach of an authenticated client.

## Layout

```
app/                    expo-router routes, shared by Android and web
  +html.tsx             the PWA document, theme anti-flash script
  (auth)/               sign-in and sign-up
  (tabs)/               authenticated area
modules/
  cairn-widget/         local Expo module: the Android home screen widget
src/
  auth/                 Supabase session and authentication actions
  db/                   Supabase client, schema types, key-value storage
  google/agenda.ts      Google consent and sending a note to the calendar
  google/creneau.ts     parsing the entered time slot, no React, tested under Node
  text/markup.ts        note formatting and link detection, tested under Node
  ui/theme.ts           single source of colours, typography and shapes
  ui/components.tsx     interface primitives
  ui/AgendaPanel.tsx    calendar send panel, inside the note screen
  ui/runes.tsx          futhark drawn as vectors, ornamental
  vault/policy.ts       vault rules, platform-free, tested under Node
  vault/secret.ts       on-device passcode storage and derivation
  widget/               the snapshot the widget reads, and what keeps it current
scripts/                theme and assetlinks generation, tests
supabase/migrations/    SQL schema and RLS policies
supabase/functions/     Deno Edge Functions: OAuth exchange and Google calls
generated/              theme-derived artefacts, committed
public/                 files served as-is by the PWA (assetlinks.json)
```

## License

Released under the [PolyForm Noncommercial License 1.0.0](LICENSE). You may read, run, modify and share the code for any noncommercial purpose. Any commercial use requires the author's prior agreement.\n