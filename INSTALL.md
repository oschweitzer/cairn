# Installing Cairn

Cairn is a notes and checklists app. It runs on Android and in a web browser.

You do not need any developer tools to use it. If you are here to work on the
code instead, see [README.md](README.md).

> **The app is in French.** Buttons, messages and labels are all French. This
> guide is in English; the app you install will not be.

---

## Which one do I want?

| | Android app | Web app |
|---|---|---|
| Home screen widget | ✅ | — |
| Fingerprint unlock for the vault | ✅ | — |
| Works offline | ✅ | ✅ |
| Installation | download an APK | open a link |
| iPhone / iPad | — | ✅ |

Both talk to the same account, so notes written in one show up in the other.

**On an iPhone, the web app is the only option.** There is no App Store build.

---

## Android

### 1. Get the APK

Ask whoever runs this Cairn instance for a build link. It looks like
`https://expo.dev/accounts/…/builds/…`, and opening it on the phone gives you a
**Download** button.

### 2. Let Android install it

Android will stop the install the first time and say something like *"For your
security, your phone is not allowed to install unknown apps from this source."*

That is normal, and it is not a warning about Cairn specifically. Android only
installs freely from the Play Store; anything else has to be allowed once, per
app that does the downloading.

Tap **Settings** in that message, turn on **Allow from this source**, then go
back. The install continues.

You are giving this permission to your browser, not to Cairn. It is worth
turning back off afterwards if you would rather.

### 3. If the install is refused anyway

- **"App not installed"** — an older Cairn is already on the phone and was
  signed with a different key. Uninstall the old one first. Your notes are on the
  server, not in the app, so nothing is lost.
- **Play Protect warns you** — expected for an app that does not come from the
  Play Store. Choose to install anyway if you trust the source of the link.
- **The download does nothing** — some browsers block `.apk` downloads. Try
  another browser, or download on a computer and transfer the file.

---

## Web, on any device

Open **https://cairn-notes.netlify.app**. That is the whole installation.

To get an icon on your home screen and a window without browser chrome:

- **Android, Chrome** — menu ⋮ ▸ *Add to Home screen*
- **iPhone / iPad, Safari** — Share ▸ *Add to Home Screen*
- **Desktop, Chrome or Edge** — the install icon at the right of the address bar

Installed this way it keeps working without a connection: notes already loaded
stay readable, and changes sync when you are back online.

---

## First run

### Creating an account

Cairn asks for an email address and a password. The address is used to sign in
and to recover the password — nothing is sent to it otherwise.

Sign in with Google is offered too, if this instance is configured for it.

### Writing something

The two buttons at the bottom right create a note (`+`) or a checklist (`☑`).
Inside a note:

- the **B** button opens formatting: bold, italic, underline, strikethrough,
  headings, bullet lists, links;
- the **book** button switches to reading, where formatting shows and links open;
- the **tag** button attaches a tag, and can create one on the spot;
- the **droplet** button colours the note.

A URL typed anywhere in the text becomes a link on its own — nothing to mark up.

A note you open and leave without writing anything is discarded rather than left
lying around empty.

### Rearranging the grid

Drag the handle at the top left of a card to move it. Pinned notes always stay
first: an ordinary note dropped among them lands just after them.

---

## The vault, and the one thing you can lose

The vault hides notes behind a passcode. Anything filed in it disappears from the
main grid and only comes back once the passcode is entered.

Set it up in **Réglages ▸ Coffre**.

> ### ⚠️ The recovery key is shown once
>
> When you turn on encryption, Cairn shows a **recovery key** and asks you to
> write it down. It is displayed once and never again.
>
> That key is what unlocks your encrypted notes on a new phone, and what saves
> them if you forget your passcode. Nobody — not the server, not whoever runs it
> — can recover it for you. **Lose it and encrypted notes are gone for good.**
>
> Write it on paper, or put it in a password manager. Not in Cairn.

Two things worth knowing about the passcode:

- it is **specific to one device**. On a second phone, the vault is set up fresh
  and shows the same notes;
- forgetting it is not a dead end. It can be replaced from
  **Réglages ▸ Coffre ▸ Remplacer le code** without losing anything — the
  passcode hides notes, it does not encrypt them. The recovery key above is a
  different thing, and that one does matter.

The vault closes on its own after five minutes without a gesture. Time spent in
another app, or in another browser tab, counts towards those five minutes: come
back quickly and the vault is still open, come back much later and it is closed.

On Android the passcode is kept in the system keystore. **On the web it is kept
in ordinary browser storage**, which is less protected — the app says so on the
setup screen.

---

## The home screen widget

Android only, and only in the installed app.

Long-press an empty spot on the home screen ▸ **Widgets** ▸ **Cairn**. Drag it
where you want and resize it by its handles.

- the **left pill** cycles the tag filter: all tags, then each tag in turn;
- **`+`** opens a new note, **`☑`** a new checklist;
- touching a note opens it.

The widget reads a copy of your notes stored on the phone, so it fills in
instantly and works with no connection.

**Vault notes are not shown.** You can turn that on in **Réglages ▸ Widget**, and
even then only the code name appears on the home screen — never the contents.

---

## Google Calendar (optional)

You can send a note to your Google Calendar as an event: open the note, tap the
calendar button at the bottom, pick a date and a time.

**What is sent: the note's title and a link back to it. Nothing else** — not the
body, not the checklist items. On a phone with Cairn installed, the link opens
the app directly.

Notes in the vault have no calendar button, and will not get one.

Connect the account in **Réglages ▸ Agenda Google**. Signing in to Cairn with
Google is a separate thing and grants no calendar access on its own.

> While this instance is in Google's test mode, the authorisation **expires after
> seven days** — a limit Google imposes, not Cairn. The app shows the expiry date
> and asks you to reconnect before it lapses.

---

## Deleting everything

**Réglages ▸ Compte ▸ Supprimer le compte.** You will have to retype your email
address, so that there is no doubt about which account is going.

Everything goes with it: notes, checklists, tags, calendar links, and what is
stored on the device. It cannot be undone.

---

## When something is wrong

**The app opens on a "Configuration à terminer" screen.** It does not know which
server to talk to. That is for whoever built it to fix — the build is missing its
configuration.

**The password reset link does nothing.** It only works in the browser that asked
for it. Request it and open it on the same device.

**Google sign-in loops or lands on a blank page.** Usually a configuration issue
on the server side. Signing in with an email and password works regardless.

**Notes are not syncing.** Cairn shows a banner when it is working from cache.
Check the connection; changes are kept locally and sent when it comes back.
