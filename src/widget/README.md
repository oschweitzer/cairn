# Android widget

A list of notes on the home screen, with a way to create more and a tag filter.

## How it holds together

```
    app (JS)                               widget (launcher process)
  ┌────────────────────┐                 ┌────────────────────────────┐
  │ WidgetSync         │  setSnapshot()  │ CairnWidgetProvider        │
  │  buildSnapshot()   │ ──────────────▶ │  header: filter, + , ☑     │
  └────────────────────┘   SharedPrefs   │ CairnWidgetService         │
                                         │  one row per note          │
                                         └────────────────────────────┘
```

The widget **does not talk to Supabase**. It is woken by the launcher, with no
session and often no network: handing it a token so it could try would be
complicated and unwise. So the app writes a snapshot every time the list
changes, and the widget reads a local file. It shows up instantly, offline as
well as after the phone restarts.

## What does not go into the snapshot

- the trash and the archive — the widget shows what you are working on;
- **the vault**, unless explicitly enabled (Settings ▸ Widget). And even then,
  only the code name goes across: never the body. The snapshot is a plaintext
  file in the app's preferences, and the vault exists precisely so that its
  contents do not sit somewhere like that;
- nothing at all when no widget is placed: `placedWidgetCount()` short-circuits
  the write.

## The buttons are on top

Google Keep's widget puts its own in a side column. On a narrow widget — two
cells across, which is what most people place — that column eats a third of the
width for four glyphs and pushes the text into a corridor. Along the top, the
same bar costs one line's height.

It does not scroll: it is a sibling of the `ListView`, not its first row.
Slipped into the list, it would disappear upwards on the first scroll.

## How tall a row is

A `RemoteViews` cannot measure anything: the rows are built in the app's process
and drawn in the launcher's, and nothing comes back. A row therefore used to show
two preview lines whatever the circumstances, so filtering down to a single list
showed two of its items with the rest of the widget empty underneath.

Two figures are enough to do better, and both are known: the widget's size, which
the launcher keeps in its options, and how many notes survive the filter. The
height left under the header — dividers deducted — is shared between the rows,
and each is told how many preview lines it may spend, floored at two and capped
at what the row layout allows.

The factory then cuts the text itself. It is not done by pushing the computed
number with `setInt(…, "setMaxLines", n)`: a `RemoteViews` refuses any method not
annotated `@RemotableViewMethod`, and refuses it when the launcher applies the
view — the widget reads "couldn't load", a long way from the line responsible.

A checklist is cut on its line breaks, exactly. A free-text note has no line
breaks to count, and where a paragraph wraps is the launcher's business, so its
length is estimated from the widget's width. Too low and the note says a little
less than it could; too high and its row runs past its share and the list
scrolls. The geometry behind these figures is written down beside them in
`CairnWidgetService.kt`, keyed to the layouts it is read from.

## The tag filter

One tap cycles: all tags → first tag → … → all tags. The current filter's name
is written in the header, otherwise you would not know what you are looking at.
Each placed widget keeps its own, stored by widget id.

A configuration activity would be richer and a great deal heavier: a second
`Activity`, its layout, its lifecycle, to pick among a handful of labels.

## Checking it

A widget renders neither on the web nor in Expo Go. It needs a native build:

```bash
npx expo prebuild --platform android --clean
```

```bash
npx eas build --platform android --profile preview
```

Then, on the device: long-press the home screen ▸ Widgets ▸ Cairn.

The module's colours are produced by `npm run theme`, which writes
`values/colors.xml` and `values-night/colors.xml` **inside the module** as well
as into `generated/`. This is not duplication for convenience: an Android
library is compiled against its own resources, not against those of the app
embedding it — a layout saying `@color/cairn_surface_page` without that colour
existing here would not compile. `npm run theme:check` refuses to let the two
copies drift.

## Still open

- The tag palette is copied by hand into `CairnWidgetService.kt`: a
  `RemoteViews` cannot resolve a resource by a computed name, it needs an
  integer. It is the only place in the project where colours escape the
  generator. A shade changed in `src/ui/theme.ts` has to be carried over there.
- `profiles.widget_force_dark` is not used yet: the widget follows the system's
  light or dark mode through `values/` and `values-night/`.
- Three deprecations are owned and documented in the code:
  `setRemoteAdapter(Int, Intent)` and both `notifyAppWidgetViewDataChanged`
  overloads. Their replacement, `RemoteCollectionItems`, needs API 31 — the
  project's floor is 24 — and requires every row to fit inside a `RemoteViews`
  memory quota, which a list of sixty notes does not guarantee.
