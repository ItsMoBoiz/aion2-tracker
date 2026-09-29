#!/usr/bin/env python3
"""Saves the official AION 2 announcements as static files for the public website.

Writes public/news/feed.json (the list) and public/news/<id>.json (each article), using the same
relay code as server/server.py. The GitHub Pages workflow runs this before every deploy and on a
schedule, so the site has fresh news without a server of its own.

Usage:  python tools/fetch_news.py
Never fails the deploy: if the official site can't be reached, it writes nothing and the app simply
hides the News button.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))

import server  # noqa: E402  (reuses news_list / news_article)


def main():
    out = ROOT / "public" / "news"
    try:
        feed = server.news_list()
    except Exception as exc:
        print("News skipped: could not reach the official site (%s)" % exc)
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


if __name__ == "__main__":
    main()
