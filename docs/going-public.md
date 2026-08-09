# Before making this repository public

An audit of what should be settled before flipping the visibility switch, and
what can wait. **Nothing here changes the repository's visibility** — that
decision is the owner's.

Audited on 2026-08-09, at `docs/public-audit` on top of the widget branch.

---

## Summary

| | Item | Verdict |
|---|---|---|
| 1 | `LICENSE` is Expo's, with Expo's copyright | **blocks** |
| 2 | A corporate email address in the git history | **decide first** — irreversible after |
| 3 | Secrets in the history | ✅ none found |
| 4 | Identifying values in tracked files | ✅ all public by design |
| 5 | Supabase: two deliberate warnings, one real gap | one easy win |
| 6 | `package.json` has no licence, description or repository | improves |
| 7 | No `.github/`, no contribution notes | improves |
| 8 | Repository description and homepage | improves |
| 9 | Branch protection | do it **after** publishing |
| 10 | How a visitor gets the app | improves |

---

## 1. The licence is Expo's, not yours — **blocking**

`LICENSE` currently reads:

```
The MIT License (MIT)

Copyright (c) 2015-present 650 Industries, Inc. (aka Expo)
```

It came in with the first commit, straight out of `create-expo-app`, and nobody
has looked at it since. GitHub reads the file, labels the repository "MIT
License", and shows that copyright line.

Publishing it as-is states, on the record, that this code is copyright Expo and
that Expo is the one granting the permission. Neither is true. The practical
consequence is that anyone reusing the code is relying on a grant from a party
that never made it.

**What to do.** Decide what licence you actually want, then write it with your
own copyright line:

- **MIT** — keep the terms, replace the copyright:
  `Copyright (c) 2026 Olivier Schweitzer`. Anyone may do anything, attribution
  required.
- **AGPL-3.0** — if you would rather that someone running a modified Cairn as a
  service had to publish their changes. Worth considering for a self-hostable
  notes app.
- **No licence at all** — delete the file. "All rights reserved" by default:
  people may read the code, not reuse it. A legitimate choice, but make it on
  purpose. Right now it is being made by accident, in Expo's name.

Whichever you pick, add the matching `"license"` field to `package.json`
(see item 6).

Note that the *fonts* have their own licences, already sitting beside each file
in `assets/fonts` — Viking under 1001fonts, Junicode under SIL Open Font. Those
are fine and unaffected. Worth a line in the README saying so, since a reader
will wonder whether the repository licence covers them. It does not.

---

## 2. A corporate email address in the history — **decide before, not after**

Two identities author the commits:

```
Olivier Schweitzer <2411238+oschweitzer@users.noreply.github.com>
Olivier Schweitzer <employer-address@example.com>
```

The second is an employer address. Once the repository is public, it is public
in every commit, permanently, and mirrored by anyone who clones. Rewriting the
history afterwards does not retract what has already been copied.

Two things to weigh, and only you can:

- **Exposure.** A work address in a public log is a small, permanent piece of
  personal and employer data. Harvestable.
- **Provenance.** Personal work authored under an employer's address is the kind
  of thing that invites an awkward question later about who owns it. Publishing
  under a personal identity avoids the ambiguity entirely.

**If you want it gone, it has to happen before publishing:**

```bash
git filter-repo --mailmap .mailmap
```

with a `.mailmap` mapping the old address to the GitHub noreply one. This
rewrites every commit hash, so it needs a force-push and it invalidates the open
pull requests — hence *before*, while there are few of them and they are yours.

Set the per-repository identity too, so it does not come back:

```bash
git config user.email "2411238+oschweitzer@users.noreply.github.com"
```

**If you would rather leave it**, that is a perfectly reasonable call. Just make
it knowingly rather than discover it later.

---

## 3. Secrets in the history — ✅ nothing found

Searched across **every commit on every branch**, not just the working tree.
Looked for:

| Pattern | Hits |
|---|---|
| `sb_secret…` (Supabase secret key) | 0 |
| `SUPABASE_SERVICE…` / service role key | 0 |
| `GOCSPX-…` (Google client secret) | 0 |
| `BEGIN … PRIVATE KEY` | 0 |
| `eyJhbGciOiJIUzI1NiI` (a JWT) | 0 |

`.env` has never been committed, on any branch. No `.jks`, `.p8`, `.p12`, `.pem`
or keystore has ever existed in the tree — `.gitignore` covered them from the
first commit.

`service_role` does appear, but only as a role *name* in SQL comments and in the
README, where it is being explained. That is documentation, not a key.

Nothing to clean up here.

---

## 4. Identifying values in tracked files — ✅ all public by design

Three values are committed and will be readable. All three are meant to be:

| Value | Where | Why it is fine |
|---|---|---|
| EAS project id `85a0f0f0-…` | `app.config.js` | Names the project; grants nothing. Building requires the signed-in account. |
| App signing certificate SHA-256 | `public/.well-known/assetlinks.json` | It is a *public* fingerprint, served at a well-known URL by definition. That is the whole mechanism. |
| Supabase project URL / anon key | **not in the repository** | They live in `.env`, in EAS env vars and in Netlify env vars. |

One thing to say out loud so nobody panics later: the Supabase URL and anon key
**are already public**, baked into the deployed PWA and the APK. That is by
design — the anon key is a publishable key, and RLS is what protects the data.
Making the repository public changes nothing about their exposure.

The corollary is that RLS carries the entire weight, which is item 5.

---

## 5. Supabase — two deliberate warnings, one real gap

The security advisors return three items. Two are intentional and should be
**documented rather than fixed**, because a future reader — or a future you —
will otherwise "fix" them and break something.

**`google_credentials` has RLS enabled and no policy** (INFO). Deliberate: that
is exactly how the Google refresh token is kept out of reach. No policy means no
row is readable or writable by any client role; only the service key, used by the
Edge Functions, gets through. The migration says so; the advisor cannot know.

**`delete_own_account()` is `SECURITY DEFINER` and callable by signed-in users**
(WARN). Deliberate too: it has to be, since the `auth` schema is out of reach of
the client role. The borrowed power is bounded to one row — `auth.uid()` is read
*inside* the function and is not a parameter, so it cannot be aimed at somebody
else. `npm run db:test` covers this, including the unauthenticated case.

**Leaked password protection is disabled** (WARN). This one is a genuine gap and
a one-click fix in the dashboard: Supabase checks new passwords against
HaveIBeenPwned. Cairn already does this check client-side (`src/auth/pwned.ts`),
so enabling it server-side adds defence in depth for anything that does not go
through the app.

Worth adding a short "Security" section to the README stating that RLS is
tested by `npm run db:test`, and that the first two warnings above are choices.
A public repository invites people to read the schema closely; better they find
the reasoning than the warning alone.

---

## 6. `package.json` — improves

```
license: (absent) | repository: (absent) | description: (absent)
```

Worth filling in once item 1 is settled. `license` in particular should agree
with the `LICENSE` file — tooling reads the field, humans read the file, and they
should not disagree.

---

## 7. Nothing in `.github/` — improves

No issue templates, no pull request template, no `CONTRIBUTING.md`, no
`CODE_OF_CONDUCT.md`.

None of this blocks anything. The one worth having early is a short
`CONTRIBUTING.md`, because this repository has real conventions that a newcomer
cannot guess: Conventional Commits, the changelog updated in the same commit as
the code, `npm run verify` before opening, and the language rule — English for
comments and docs, French for what the user reads. Those live in `AGENTS.md`
today, which nobody thinks to open.

Simplest version: a `CONTRIBUTING.md` that says "read `AGENTS.md`" and repeats
the three commands that matter.

---

## 8. Description and homepage — improves

The GitHub description is French:

> Notes et listes multiplateformes : Android, PWA et widget depuis un seul dépôt Expo.

The documentation is now English. Worth aligning — and it is the first thing
anyone reads, before the README.

`homepageUrl` is empty. Pointing it at `https://cairn-notes.netlify.app` gives a
visitor something to try in one click instead of cloning.

While you are there: repository topics (`expo`, `react-native`, `supabase`,
`notes-app`, `pwa`, `android-widget`) are how people find it at all.

---

## 9. Branch protection — **after** publishing

```
Upgrade to GitHub Pro or make this repository public to enable this feature.
```

Not available on a private repository on the free plan. It becomes available the
moment the repository is public, so this is a post-publication step, not a
blocker. Worth doing straight away: require a pull request on `main`, which is
already how the work has been going.

---

## 10. How a visitor actually gets the app — improves

`INSTALL.md` currently says to ask whoever runs the instance for a build link.
That works for a private repository with one user. In public, it is a dead end.

Two options, either is fine:

- attach the APK to a **GitHub Release**, and point `INSTALL.md` at
  `/releases/latest`;
- or say plainly that no prebuilt APK is distributed, and that the web app is the
  supported route with the APK left to `README.md`'s build instructions.

The second is less work and perfectly honest. The one thing not to do is leave a
guide that tells people to ask someone.

Related: a public Cairn points at **your** Supabase project. Nobody else can use
it — they will have to stand up their own, which `README.md` already covers — but
it is worth one sentence in `INSTALL.md` so it does not read as a broken app.

---

## Suggested order

1. Settle the licence (item 1). Blocks.
2. Decide on the email history (item 2). Irreversible once public.
3. Enable leaked password protection (item 5). One click.
4. Fill in `package.json`, the description, the homepage, the topics
   (items 6 and 8). Ten minutes.
5. **Publish.**
6. Turn on branch protection (item 9).
7. Add `CONTRIBUTING.md` and a release with the APK (items 7 and 10), whenever.
