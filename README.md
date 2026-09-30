# Aion 2 - Progress Tracker

Tracks daily, weekly and one-time activities, the leveling roadmap, the gear progression path, stats and
gear for several characters.

**Live site:** https://itsmoboiz.github.io/aion2-tracker/

The site runs entirely in the browser and is hosted on GitHub Pages. Signing in with Google is optional:
it syncs your data across browsers and devices. Without it, data stays in that browser.

## Using the site

Open the link above. Everything works straight away and is saved in the browser. Use **Sign in** (top right)
to keep the same characters and progress on every device where you sign in with the same Google account.

## Where data is saved

- **Signed in:** each person's data is saved in their own private folder in Firebase
  (`users/<uid>/docs`) and syncs across every browser where they sign in. Nobody else can read it.
  The browser also keeps a copy for instant loading and offline use; the newest change wins.
  The first time a device with existing data signs in, it asks which copy to keep.
- **Not signed in:** data is saved only in that browser's `localStorage`.
- **Backups:** Settings → Data exports and imports everything as a JSON file.
  Settings → Tasks and Scoring can also be exported and imported on their own, to share with others.
- **Clear all data** is only available to the site owner.

## Folder layout

```
aion2-tracker/
├─ .github/workflows/
│  └─ pages.yml         deploys public/ to GitHub Pages and checks the news hourly
├─ public/              everything the browser loads (edit these)
│  ├─ index.html
│  ├─ css/styles.css
│  ├─ js/app.js
│  ├─ js/firebase-config.js   public Firebase web config + owner email hash
│  ├─ vendor/firebase-10.12.2/ Firebase SDK (served locally)
│  └─ assets/logo.svg
├─ tools/
│  └─ fetch_news.py     saves the official announcements for the site
├─ server/              optional local server
│  ├─ server.py         Python 3.7+, standard library only
│  └─ serve.ps1         fallback (Windows PowerShell 5.1+)
├─ start.bat            starts the local server
└─ firestore.rules      Firebase security rules (each user can only reach their own data)
```

## Publishing changes

Edit the files in `public/`, then commit and push to `main` (for example with GitHub Desktop:
**Commit to main**, then **Push origin**). The workflow in `.github/workflows/pages.yml` publishes the
site in about a minute. Check its progress under the repository's **Actions** tab.

Each deploy stamps a build id into `index.html` (so browsers fetch the new CSS/JS) and into
`version.json`. Open pages check `version.json` every 60 seconds and reload when a new version is live.
If a dialog is open or stats are unsaved, a "Reload now" banner appears instead. Saved data is not
affected by a reload.

Data from older versions is brought up to date automatically when it loads (`normalize()` in `app.js`),
so code changes don't break saved progress.

## Updating everyone's activity lists

The official Aion 2 activities are the `CATALOG` list near the top of `public/js/app.js`. Each has a
permanent `key` and a `rev` number. Everyone's saved lists are brought up to date the next time they
open the site:

- **New activity:** add an entry with a new key. It is added to everyone's list, with a notice.
- **Changed activity:** edit it and raise `rev` (1 → 2). Each field updates for everyone who hasn't
  changed that field themselves.
- **Removed from the game:** add `retired: true` and raise `rev`. It's hidden for everyone; past history stays.

People's own activities, renames, hidden or deleted activities, and progress are never overwritten.
Changes to someone's own lists in Settings only affect them.

## Official news

The deploy workflow runs `tools/fetch_news.py` on every push, saving the official announcements
(AION 2 English notice board) as `public/news/feed.json` and `public/news/<id>.json`, which the page reads.
Every hour on the hour it also checks the official list against the news already on the site and redeploys
only when there's a new or edited announcement; otherwise the run stops after the check.
GitHub pauses scheduled runs if the repository has had no activity for 60 days; any push restarts them.

## Firebase (sign-in and sync)

- `public/js/firebase-config.js` holds the Firebase **web** config. It is public by design and safe to
  commit. Never commit service-account keys or other private credentials.
- `firestore.rules` must be published in the Firebase console (Firestore → Rules) whenever it changes.
- The site's domain (`itsmoboiz.github.io`) must be listed under Authentication → Settings →
  Authorized domains.

## Running it locally (optional)

Double-click **`start.bat`**. It uses Python 3 if it's installed, otherwise the built-in PowerShell server,
then opens http://localhost:8080/. Or run a server yourself:

```
python server\server.py [--port 8080] [--host 0.0.0.0] [--no-browser]
powershell -ExecutionPolicy Bypass -File server\serve.ps1 [-Port 8080] [-NoBrowser]
```

The local server relays the official news live and reloads open pages within 2 seconds of a file change,
which makes it handy for testing before you push. Data saved on `localhost` is separate from the live site.

## Resets

- Default: weekly reset on **Wednesday 16:00 Asia/Qatar** (= Wed 09:00 Aion 2 server time); daily reset at 16:00.
  Both can be changed in **Settings → Reset times**.
- All times are shown in the viewer's own time zone.
- At each daily reset, the day's completion is logged. At each weekly reset, the week is archived to **History**
  (up to 156 weeks). If the site was closed at reset time, this happens the next time it opens.

## Scoring

Item score = item level × level weight × rarity multiplier + enchant × enchant weight.
Gear Score = sum of all 15 slots. Stat Score = Σ stat × weight. Combat Power = Gear Score + Stat Score.
All weights are editable in **Settings → Scoring**. These are tracking scores for comparing your own characters,
not the game's official numbers. Combat Power can also be entered by hand (Manual mode on the character page).
