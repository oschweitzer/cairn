# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Repository conventions

## Language: English for the repository, French for the app

Everything a *contributor* reads is in English:

- code comments, in every language — TypeScript, Kotlin, SQL, XML, JS;
- documentation: `README.md`, `INSTALL.md`, `AGENTS.md`, `CHANGELOG.md`, and any
  `README.md` living next to a module;
- commit messages and pull request bodies.

Everything a *user* reads is in French, and stays that way:

- labels, tooltips, placeholders, toasts, error messages;
- `accessibilityLabel` and `accessibilityHint` — a screen reader speaks to the
  user, not to us;
- anything inside `<Txt>`, `Alert`, or a `label=` prop.

Cairn is a French app. The distinction is not cosmetic: a translation pass that
leaks into on-screen copy is a product change wearing a documentation change's
clothes.

Comments are not decoration here. They carry *why* a decision was made — why the
vault holds one data key, why the masonry grid does not reorder while you drag,
why `__` means underline rather than bold. When you touch code that carries such
a comment, keep the reasoning true. A stale explanation is worse than none: it
is believed.

## Commit messages — Conventional Commits 1.0.0

Spec: <https://www.conventionalcommits.org/en/v1.0.0/>

    <type>[optional scope][!]: <description>

    [optional body]

    [optional footers]

Types used here: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`,
`ci`, `chore`, `style`, `revert`.

The rules that matter:

- the description is imperative, lowercase, with no trailing period;
- a breaking change is flagged by a `!` before the `:` **and** a
  `BREAKING CHANGE: …` footer;
- the ticket goes in a footer, never in the description:
  `Refs: #12` or `Closes: #12`.

The scope names the area touched, not the file: `note`, `grid`, `vault`, `tags`,
`calendar`, `widget`, `db`, `web`, `android`.

```
feat(note): create a tag from the editor panel

Closes: #1
```

## CHANGELOG.md — Keep a Changelog 1.1.0

Spec: <https://keepachangelog.com/en/1.1.0/>

A changelog is read by humans, not by a tool: it is not `git log` copied out.
Each entry says what changes **for someone using Cairn**, not which file moved.

- an `## [Unreleased]` section on top, where in-flight changes land;
- versions below it, most recent first, as `## [0.2.0] - 2026-08-08`;
- inside, only these headings, in this order: `### Added`, `### Changed`,
  `### Deprecated`, `### Removed`, `### Fixed`, `### Security`;
- one line per change, ending with its ticket link:
  `- Create a tag from the note editor. ([#1])`;
- link references (`[#1]: https://…/issues/1`) live at the bottom of the file;
- dates are ISO 8601, `YYYY-MM-DD`.

**Every pull request updates the changelog in the same commit as the code it
describes.** An entry added afterwards is no longer attached to anything.

## Pull requests

One pull request per ticket. The body recalls the ticket (`Closes #n`), what
changes, and how to check it.

Before opening, `npm run verify` must pass: types, theme contrast, pure logic,
and the SQL schema replayed against real Postgres.
