# Changelog

All notable changes to Cairn are recorded here.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and the project follows [semantic versioning](https://semver.org/).

## [Unreleased]

### Added

- The Android app is published as a GitHub Release. Tagging `v*` builds the APK
  on EAS and attaches it to a Release, so installing Cairn no longer means asking
  someone for a build link — `INSTALL.md` points at `/releases/latest`. Every
  merge to `main` also starts an internal build, without publishing anything.
  ([#25])
- **Masquer le contenu**, under the code name of a vault note. Its card then
  shows the code name alone — no preview, no items, no count — while the note
  itself opens and reads as usual. Off by default: with the vault open, a card
  shows what its note says, and this is the exception you choose note by note.
  ([#40])
- Open a link without leaving the writing view. When the caret is inside an
  address — in the body or in a checklist item — a bar appears above the
  toolbar: **Ouvrir**, followed by the address. One tap opens it in a new tab.
  On a computer, Cmd or Ctrl and a click on the address does the same. The
  address itself still cannot be underlined while you write: a text field holds
  plain text, and nothing else. ([#32])
- Android widget: your notes and lists on the home screen, with the create
  buttons pinned along the top and a tag filter. Touching a note opens it. The
  widget reads a local copy written by the app, so it shows up offline and
  without ever asking the server. Vault notes are left out unless you say
  otherwise — and even then, only the code name goes across. ([#6])
- Settings ▸ Widget, for that last setting. ([#6])
- Reorder the home screen by dragging the handle at the top left of each card.
  Pinned notes stay on top: an ordinary note dropped among them lands just
  after. The order is saved and follows your devices, editing a note no longer
  floats it back up, and a new note arrives at the top. The handle disappears in
  selection mode and under a filter, where the order of a partial view would
  mean nothing. ([#5])
- Text formatting in notes and lists: bold, italic, underline, strikethrough,
  heading, subheading and bullet lists, from a toolbar under the editor's **B**
  button. The markup travels inside the text (`**bold**`, `# heading`,
  `- bullet`), so nothing changes for the vault, for search, or for the calendar
  export. ([#3])
- Links are clickable. A URL written mid-sentence is recognised without any
  markup — so notes written before this become clickable with nothing to do to
  them — and `[label](address)` makes a named link. A button switches the editor
  between writing and reading; reading is where links open and formatting
  shows. ([#3])
- Create a tag straight from the note editor, under the tag button: it is put on
  the note right away, in the least-used colour of the palette. A name already
  taken puts the existing tag on the note instead of refusing. ([#1])
- `INSTALL.md`, an English guide for people who just want the app on their
  phone: installing the APK, the web app, the vault and the one thing that cannot
  be recovered, the widget, and the optional calendar link. ([#15])
- `docs/going-public.md`, an audit of what to settle before making the
  repository public. Two items need a decision first: the `LICENSE` file is
  Expo's, copyright included, and a corporate email address sits in the git
  history. No secret was found anywhere in the history. ([#16])
- Repository conventions: commit messages following
  [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/),
  changelog following Keep a Changelog 1.1.0. They live in `AGENTS.md`, which
  `CLAUDE.md` includes.

### Changed

- The vault stays open while you are working, and closes after five minutes
  without a gesture — a touch, a scroll, a click, a keystroke. It used to close
  the instant Cairn lost focus, so a glance at another tab or another app meant
  the code again, however brief the glance. Time spent away counts towards those
  five minutes rather than pausing them: come back after ten seconds and the
  vault is open, come back after six minutes and it is closed, on the web as on
  Android. What this gives up is stated plainly — a phone picked up while Cairn
  sits in the background now has whatever is left of the five minutes, where it
  had nothing. ([#39])
- Migrations reach a database through `supabase db push`, not through the
  dashboard's SQL editor. `supabase/config.toml` makes the repository a project
  the CLI will link, and the README says what pasting SQL by hand costs: the run
  leaves no trace, so nothing can afterwards tell an applied migration from a
  missing one. Two of them had gone missing that way, and the app stopped reading
  anything at all. ([#20])
- `npm run verify` runs on every pull request and every push to `main`. It needs
  no secret and no network, so the workflow is granted nothing beyond reading the
  repository. ([#24])
- Comments, documentation, commit messages and pull request bodies are written
  in English. The app itself stays in French. ([#14])
- The Android app now carries native code of its own, for the widget. It no
  longer runs inside Expo Go: `npm run android` builds a development version
  (`expo run:android`). The web app and the PWA are unaffected. ([#6])
- Comments, documentation, commit messages and pull request bodies are written
  in English. The app itself stays in French. ([#14])
- The Android app now carries native code of its own, for the widget. It no
  longer runs inside Expo Go: `npm run android` builds a development version
  (`expo run:android`). The web app and the PWA are unaffected. ([#6])

### Fixed

- The hour of a calendar export can be corrected on a phone again. It was one
  text field expecting `HH:MM`, and the numeric keyboard offers no `:` — deleting
  the separator once left the hour impossible to rewrite, the send button greyed
  out, and closing the panel the only way out. Hours and minutes are now two
  fields of two digits with the `:` drawn between them: the second digit of the
  hour moves on to the minutes, and a lone `9` becomes `09` when you leave the
  field. ([#47])
- Writing in a list no longer happens under the keyboard. On a phone, the
  **Ajouter un élément** field sits at the bottom of the note and the keyboard
  was drawn straight over it: you typed without seeing the text, so a typo only
  turned up once the keyboard was gone — and every item added pushed the field
  a little further under the keys. The screen now folds in front of the
  keyboard, and the field comes back into view each time an item is added. The
  note's body gains the same, on the same screen. ([#38])
- Vault notes show their content again when the vault is opened a second time.
  The cards came back empty — no preview, no items — as if the vault had lost
  what it was holding; the first opening after a start worked, the ones after it
  did not. Nothing was ever lost: the notes were read from the cache a moment
  before the key that opens them arrived, and the screen never went back over
  them once it had. ([#40])
- The fingerprint button works again once the vault has closed. It had gone
  silent — no prompt, no message, nothing — and only a restart brought it back;
  an interrupted request kept hold of the sensor for the whole app, and every
  press after that returned instantly without showing anything. The hold is now
  released, on leaving the vault screen and when a press runs into it. And when
  the sensor really is busy, the screen says so instead of looking broken.
  ([#35])
- The back arrow leads somewhere when a note was opened from the home-screen
  widget. It led nowhere at all: a widget opens the note directly, so there was
  no screen behind it to return to. It now goes to the grid. The same held for
  the widget's two create buttons, and for a note opened from a Google Calendar
  event — both are fixed by the same change, on the web as on Android. ([#34])
- The app opens on the notes it had already loaded, instead of starting from an
  empty grid every time. The saved cache was being thrown away at every startup:
  a request still in flight could be written down along with it, and what was
  written back could not be read again. Starting the web app offline now shows
  your notes, which was the whole point of saving them. Vault and trash notes
  are still left out, on Android as on the web. ([#27])
- Widget: a note's preview now uses the room the widget actually has. It was
  held to two lines whatever happened, so filtering down to a single list showed
  two of its items with the rest of the widget empty below. The height left under
  the header is now shared between the notes on show, and a resized widget shares
  it out again.
- Widget: notes are separated by a seam with air around it, instead of sitting
  flush against one another.
- Widget: the rounded corners no longer clash with the border. From Android 12
  the launcher masks the widget with a corner radius of its own, which cut the
  border away at each corner and let the wallpaper through; the background now
  follows that radius, and keeps the chisel-cut 6 points below Android 12.
- Text is no longer clipped on Android the first time the app opens. The logo
  showed as "CAI" with the rune line too short beneath it, and the tab bar read
  "Not…", "Ta…", "Réglag…". The screen was being laid out before the fonts had
  loaded, so every text kept a box measured for the system font and was then
  drawn in a wider one; the app now waits for the fonts before painting, behind
  the splash screen it was already holding.
- Changing the tag of a note that already had one works. The old one used to
  come back: tags were replaced wholesale by a delete followed by an insert, and
  two quick gestures interleaved. They are now put on and taken off one at a
  time, which makes them independent. The inherited colour follows the change
  instead of staying on the old category's; a colour picked by hand is still
  left alone. ([#4])
- Note editor: the content field fills the height available under the title
  instead of stopping at 220 points. The large dead zone that followed it — two
  thirds of the screen on a desktop — was clickable and did nothing; it is now
  part of the field. No scrollbar as long as the text fits the space on offer.
  ([#2])
- A failure to read the notes now says what kind of failure it is. A server that
  is unreachable, a session that has expired, an access refused and a database
  left behind by an app update called for the same shrug — `Lecture impossible`,
  followed by whatever Postgres had said. They now get their own heading, and a
  sentence saying whether waiting will help. The technical line stays on screen
  underneath, in smaller type, because that is the one worth copying into a bug
  report. The banner shown over cached notes no longer draws a crossed-out
  aerial for something that has nothing to do with the network. ([#21])
- Changing the tag of a note that already had one works. The old one used to
  come back: tags were replaced wholesale by a delete followed by an insert, and
  two quick gestures interleaved. They are now put on and taken off one at a
  time, which makes them independent. The inherited colour follows the change
  instead of staying on the old category's; a colour picked by hand is still
  left alone. ([#4])
- Note editor: the content field fills the height available under the title
  instead of stopping at 220 points. The large dead zone that followed it — two
  thirds of the screen on a desktop — was clickable and did nothing; it is now
  part of the field. No scrollbar as long as the text fits the space on offer.
  ([#2])

## [0.1.0] - 2026-08-08

First version, written before this changelog existed. The entries below
summarise the four initial commits; they are reconstructed, not written as the
work happened.

### Added

- Cross-platform notes and lists: masonry grid, pinning, archive, trash,
  coloured tags, offline search, light and dark themes.
- End-to-end encrypted vault: one data key per person, sealed by a recovery key
  shown exactly once, locked behind a passcode or biometrics.
- Tooltips on every icon control.
- Password recovery and account deletion.
- Exporting a note to Google Calendar, APK builds, and Expo configuration in
  JavaScript.

[Unreleased]: https://github.com/oschweitzer/cairn/compare/f630263...HEAD
[#1]: https://github.com/oschweitzer/cairn/issues/1
[#2]: https://github.com/oschweitzer/cairn/issues/2
[#3]: https://github.com/oschweitzer/cairn/issues/3
[#4]: https://github.com/oschweitzer/cairn/issues/4
[#5]: https://github.com/oschweitzer/cairn/issues/5
[#6]: https://github.com/oschweitzer/cairn/issues/6
[#14]: https://github.com/oschweitzer/cairn/issues/14
[#15]: https://github.com/oschweitzer/cairn/issues/15
[#16]: https://github.com/oschweitzer/cairn/issues/16
[#20]: https://github.com/oschweitzer/cairn/issues/20
[#21]: https://github.com/oschweitzer/cairn/issues/21
[#24]: https://github.com/oschweitzer/cairn/issues/24
[#25]: https://github.com/oschweitzer/cairn/issues/25
[#27]: https://github.com/oschweitzer/cairn/issues/27
[#32]: https://github.com/oschweitzer/cairn/issues/32
[#34]: https://github.com/oschweitzer/cairn/issues/34
[#35]: https://github.com/oschweitzer/cairn/issues/35
[#38]: https://github.com/oschweitzer/cairn/issues/38
[#39]: https://github.com/oschweitzer/cairn/issues/39
[#40]: https://github.com/oschweitzer/cairn/issues/40
[#47]: https://github.com/oschweitzer/cairn/issues/47
