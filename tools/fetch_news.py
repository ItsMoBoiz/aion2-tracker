#!/usr/bin/env python3
"""Saves the official AION 2 announcements as static files for the public website.

Writes public/news/feed.json (the list) and public/news/<id>.json (each article), using the same
relay code as server/server.py. The GitHub Pages workflow runs this before every deploy and on a
schedule, so the site has fresh news without a server of its own.

Usage:
  python tools/fetch_news.py                  save the news
  python tools/fetch_news.py --check SITE_URL save it only if it differs from the news already
                                              published at SITE_URL (used by the scheduled check)

In a GitHub Actions run it sets the step output `changed=true|false`, so the workflow only
redeploys the site when there is something new.
Never fails the deploy: if the official site can't be reached, it writes nothing and the app simply
hides the News button.
"""
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))

import server  # noqa: E402  (reuses news_list / news_article)


def set_output(changed):
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write("changed=%s\n" % ("true" if changed else "false"))


def published_items(site_url):
    """The announcement list currently on the live site, or None if it can't be read."""
    url = site_url.rstrip("/") + "/news/feed.json"
    try:
        req = urllib.request.Request(url, headers={"Cache-Control": "no-cache"})
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8")).get("items")
    except Exception as exc:
        print("Published news not readable (%s); treating as changed" % exc)
        return None


def main():
    args = sys.argv[1:]
    check_url = args[args.index("--check") + 1] if "--check" in args and len(args) > args.index("--check") + 1 else None

    out = ROOT / "public" / "news"
    try:
        feed = server.news_list()
    except Exception as exc:
        print("News skipped: could not reach the official site (%s)" % exc)
        set_output(False)
        return

    # The list holds each announcement's id, title and last-edited time, so an unchanged list
    # means no new or edited announcements.
    if check_url and published_items(check_url) == feed.get("items", []):
        print("No new announcements; the site is already up to date")
        set_output(False)
        return

    out.mkdir(parents=True, exist_ok=True)
    saved = 0
    for item in feed.get("items", []):
        try:
            article = server.news_article(item["id"])
        except Exception as exc:
            print("  article %s skipped (%s)" % (item.get("id"), exc))
            continue
        (out / (item["id"] + ".json")).write_text(json.dumps(article), encoding="utf-8")
        saved += 1
    (out / "feed.json").write_text(json.dumps(feed), encoding="utf-8")
    print("News saved: %d announcements, %d articles" % (len(feed.get("items", [])), saved))
    set_output(True)


if __name__ == "__main__":
    main()
