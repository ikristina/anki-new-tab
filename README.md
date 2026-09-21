# Anki New Tab

A Chrome extension that turns every new tab into a quick Anki review. It shows one random card that's due, lets you reveal the answer and grade it, and writes the grade back to Anki. It also has a Pomodoro timer in the header.

- Random due card on every new tab, from the decks you choose
- Grade with **Again / Hard / Good / Easy** (buttons or keys 1–4); grades are saved in Anki
- Optional new cards, with a daily limit you set
- Pomodoro timer shared across tabs, with a desktop notification when a phase ends
- Light and dark mode

The extension makes no network requests other than to Anki on `127.0.0.1:8765`.

## What you need

| | |
|---|---|
| **Anki** (desktop) | Anki 2.1.45 or newer. Tested with Anki 26.9.2 on macOS. |
| **Anki add-on** | **AnkiConnect**, code `2055492159`. This is the only add-on required. |
| **Browser** | A Chromium browser with Manifest V3 support. Built and tested in Chrome; Edge, Brave and Arc use the same extension format but haven't been tried. Firefox isn't supported. |

You don't need Node.js or any build step to use the extension. Node is only for running the tests.

## Install

### 1. Install the AnkiConnect add-on in Anki

AnkiConnect is what lets other programs talk to Anki. Without it the extension shows "Can't reach Anki".

1. Open Anki.
2. Go to **Tools → Add-ons → Get Add-ons…**
3. Paste the code **`2055492159`** and click **OK**.
4. **Restart Anki** when it asks.

Add-on page: <https://ankiweb.net/shared/info/2055492159>

**Check that it works.** With Anki open, run this in a terminal:

```bash
curl -s localhost:8765 -X POST -d '{"action":"version","version":6}'
```

You should get back `{"result": 6, "error": null}`. If you get "connection refused", Anki isn't running or the add-on isn't installed.

**Leave AnkiConnect's settings at their defaults** (Tools → Add-ons → AnkiConnect → Config):

| Setting | Default | Note |
|---|---|---|
| `webBindAddress` | `127.0.0.1` | Keep it local. |
| `webBindPort` | `8765` | The extension expects this port (see below if you change it). |
| `apiKey` | `null` | Leave unset. The extension doesn't send a key, so AnkiConnect would reject its requests. |

### 2. Load the extension in your browser

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this project folder (the one containing `manifest.json`).
4. Open a new tab. If Chrome asks whether to keep the extension's new tab page, choose **Keep it**.

There's no build step. After you change a file, click the reload icon on the extension's card on `chrome://extensions`.

### 3. Use it

1. **Keep Anki open** with your profile loaded. The extension can only reach it while it's running.
2. Open a new tab. You'll see a due card.
3. Click the gear (top right) to choose decks. With none ticked, every deck is used.

## Using it

**Keys.** Chrome puts focus in the address bar on a new tab, so click the page once first.

| Key | Action |
|---|---|
| Space / Enter | Show answer |
| 1 / 2 / 3 / 4 | Again / Hard / Good / Easy |

**Settings** (gear icon):

- **Decks**: tick the decks to draw from. Subdecks are included.
- **New cards**: off by default. Tick "Include new cards" and set a daily limit. While you're under the limit, about 1 in 4 cards is new. Cards you first studied today count toward the limit, whether you studied them here or in Anki. This is separate from Anki's own "new cards per day" setting, which doesn't apply to searches.
- **Pomodoro**: lengths of focus (25 min), break (5 min) and long break (15 min) sessions.

**Skip this card** loads a different card without grading it.

**Pomodoro.** Press Start in the header. Each phase waits for you to start it. Every fourth focus session is followed by the long break, and skipping a session doesn't count toward that. The countdown is shared by all open tabs and appears in the tab title. A background worker shows a desktop notification when a phase ends, even if no new tab is open. If you don't see notifications, allow them for your browser in your system's notification settings.

**Which cards appear.** Cards that are due (review and learning) from the selected decks. Suspended and buried cards are excluded.

## Good to know

- Grades are saved to Anki's collection. Anki's window doesn't redraw by itself, so return to the Decks screen or re-run a search in Browse to see them.
- The extension doesn't sync to AnkiWeb. Sync from Anki as usual.
- Cards render in a sandboxed frame. JavaScript inside card templates doesn't run, and audio isn't supported yet.
- **Several browsers or tabs at once** work fine: they share one Anki, which handles requests one at a time. Just before saving a grade, the extension re-checks the card. If it was reviewed, suspended or buried in the meantime (in another browser, another tab or Anki itself), your answer is skipped instead of counted twice, and you get another card. If Anki doesn't reply in time, the extension checks whether the answer was saved before asking you to grade again.
- The Pomodoro timer is kept per browser, and settings sync only within the same browser account, so set them up once in each browser.
- Your settings are saved with your browser profile (and sync across your devices if Chrome sync is on). The Pomodoro state stays on the current device.

## Troubleshooting

- **"Can't reach Anki"**: Anki isn't open, no profile is loaded, or AnkiConnect isn't installed. Run the `curl` check above.
- **Grading says Anki only accepts the next card in its study queue**: Anki's scheduler can hold a study queue in memory (for example after you've studied in Anki). While it does, it only accepts an answer for the card at the head of that queue, or an intraday learning card. AnkiConnect can't get around this. The card stays on screen: use Skip, or grade it in Anki. Details are logged in the page console as `answerCards failed`.
- **Still unreachable with Anki open**: if AnkiConnect rejects the extension's origin, add `chrome-extension://<extension id>` to `webCorsOriginList` in AnkiConnect's config, then restart Anki. The ID is on `chrome://extensions`.
- **Changed AnkiConnect's port**: update `ENDPOINT` in `anki.js` and `host_permissions` in `manifest.json` to match, then reload the extension.
- **No Pomodoro notification**: allow notifications for your browser in your system settings. The timer still counts down without them.

## Development

```bash
npm test
```

Runs the unit tests with Node's built-in runner and needs no dependencies. They cover the search queries (deck-name escaping, the new-card limit and mix), random pick, deck sorting and the Pomodoro state machine.

| File | Purpose |
|---|---|
| `manifest.json` | Extension manifest (MV3, new tab override, background worker) |
| `newtab.html` / `.css` / `.js` | The new tab page and its logic |
| `anki.js` | AnkiConnect client and search-query helpers |
| `render.js` | Builds the card document for the sandboxed frame |
| `settings.js` | Settings and timer storage |
| `pomodoro.js` | Pomodoro state machine (pure functions) |
| `background.js` | Service worker: alarm and notifications |
