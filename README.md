# Aion 2 - Progress Tracker

Tracks daily and weekly activities, stats and gear for several characters.
Runs entirely in the browser; data is saved in `localStorage`. There is no login and no backend database.

## Start

Double-click **`start.bat`**. It uses Python 3 if it's installed, otherwise the built-in PowerShell server,
then opens http://localhost:8080/.

Or run a server yourself:

```
python server\server.py [--port 8080] [--host 0.0.0.0] [--no-browser]
powershell -ExecutionPolicy Bypass -File server\serve.ps1 [-Port 8080] [-NoBrowser]
```

`--host 0.0.0.0` (Python server only) lets other devices on your network open the tracker.
Each device keeps its own data.

## Folder layout

```
aion2-tracker/
├─ start.bat            launcher (Python, else PowerShell)
├─ server/
│  ├─ server.py         main server (Python 3.7+, standard library only)
│  └─ serve.ps1         fallback server (Windows PowerShell 5.1+)
├─ public/              everything the browser loads (edit these)
│  ├─ index.html
│  ├─ css/styles.css
│  ├─ js/app.js
│  └─ assets/logo.svg
├─ tools/
│  └─ build-single-file.ps1   bundles public/ into dist/ for the shareable link
└─ dist/
   └─ aion2-tracker.html      generated; don't edit by hand
```

## Shareable link

The hosted version is at https://claude.ai/artifact/Jh6mtVPcqsarvcswYizSDH (private until shared from its Share menu).
After changing files in `public/`, run `tools\build-single-file.ps1` and republish `dist/aion2-tracker.html`
to the same link (keep its `db` and `user` capabilities). The hosted page doesn't update itself when
local files change, and it offers backups through copy and paste instead of file downloads.

### Where data is saved

- **Shared link:** each signed-in person's data is saved to their own private folder in the page's
  database (`data/users/<id>/`) and syncs across every device where they open the link. Nobody else
  can read it, including the page owner. The browser also keeps a copy for instant loading and
  offline use; the newest change wins. People you share the link with need **Contributor** access
  to save. With view-only access their data stays in their own browser.
- **Local app (`start.bat`):** data is saved only in that browser's `localStorage`.

### Official news

- **Local app:** the server relays the official announcements live
  (`/api/news`, `/api/news/<id>` from the AION 2 community API, English notice board) and the
  page refreshes them every 15 minutes.
- **Shared link:** claude.ai pages can't load other websites, so the news there is a copy kept in
  the page's shared storage (`news/feed` and `news/feed/articles/<id>`). Everyone can read it; only
  the owner can change it. It is refreshed by asking Claude to update the news. Pictures inside
  articles only show in the local app.

## Live updates and caching

- Every response is sent with `Cache-Control: no-cache` and an ETag, so browsers always check for a newer file.
- `index.html` is served with a build hash in place of `__BUILD__`, so CSS/JS URLs change whenever a file changes.
- Open pages check `/__version` every 2 seconds. A CSS change is applied without reloading. Any other change
  reloads the page. If a dialog is open or stats are unsaved, a "Reload now" banner appears instead.
  Saved data is not affected by a reload.
- Data from older versions is automatically brought up to date when it loads (`normalize()` in `app.js`),
  so code changes don't break saved progress.

## Resets

- Default: weekly reset on **Wednesday 16:00 Asia/Qatar** (= Wed 09:00 Aion 2 server time); daily reset at 16:00.
  You can change both in **Settings → Reset times**.
- All times are shown in the viewer's own time zone.
- At each daily reset, the day's completion is logged. At each weekly reset, the week is archived to **History**
  (up to 156 weeks). If the app was closed at reset time, this happens the next time it opens.

## Scoring

Item score = item level × level weight × rarity multiplier + enchant × enchant weight.
Gear Score = sum of all 15 slots. Stat Score = Σ stat × weight. Combat Power = Gear Score + Stat Score.
All weights are editable in **Settings → Scoring**. These are tracking scores for comparing your own characters,
not the game's official numbers.
