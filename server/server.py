#!/usr/bin/env python3
"""Aion 2 - Progress Tracker: local web server (Python 3.7+, standard library only).

Serves ../public and keeps every browser on the latest version:
  * Every response is sent with "Cache-Control: no-cache", so browsers always
    check with the server before using a cached copy.
  * index.html gets a build id (a hash of all app files) in place of __BUILD__,
    so css/js URLs change whenever any file changes.
  * GET /__version returns the hash of every file. The open page checks it
    every 2 seconds: stylesheet edits are swapped in without a reload; other
    edits reload the page (the user's data is in localStorage and is kept).
  * GET /api/news and /api/news/<id> relay the official AION 2 announcements
    (cached for 10 and 30 minutes).

Usage:
    python server.py [--port 8080] [--host 127.0.0.1] [--no-browser]

Use --host 0.0.0.0 to let other devices on your network open the tracker.
"""
import argparse
import hashlib
import http.server
import json
import os
import re
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = (Path(__file__).resolve().parent.parent / "public").resolve()
BUILD_TOKEN = b"__BUILD__"

# Official AION 2 announcements (English board). The API only answers the official site's
# pages in a browser, so the server fetches it on the app's behalf: GET /api/news, /api/news/<id>.
NEWS_API = "https://api-global-community.plaync.com/aion2_global/board/notice_en/article"
NEWS_PAGE = "https://aion2.plaync.com/en-us/board/notice/list"
NEWS_ARTICLE_URL = "https://aion2.plaync.com/en-us/board/notice/view?articleId={}"
NEWS_HEADERS = {
    "Referer": "https://aion2.plaync.com/",
    "Origin": "https://aion2.plaync.com",
    "User-Agent": "Mozilla/5.0 (Aion2ProgressTracker)",
    "Accept": "application/json",
}
NEWS_ID = re.compile(r"^[0-9a-f]{24}$")
_news_cache = {}
_news_lock = threading.Lock()


def _fetch_json(url):
    req = urllib.request.Request(url, headers=NEWS_HEADERS)
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _cached(key, ttl, load):
    with _news_lock:
        hit = _news_cache.get(key)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
    value = load()
    with _news_lock:
        _news_cache[key] = (time.time(), value)
    return value


def _meta_item(a):
    ts = a.get("timestamps") or {}
    return {
        "id": a.get("id", ""),
        "title": (a.get("title") or "").strip(),
        "summary": a.get("summary") or "",
        "thumb": a.get("thumbnailUrl") or "",
        "postedAt": int(ts.get("postedEpoch") or 0) * 1000,
        "updatedAt": int(ts.get("updatedEpoch") or 0) * 1000,
        "url": NEWS_ARTICLE_URL.format(a.get("id", "")),
    }


def news_list():
    def load():
        data = _fetch_json(NEWS_API + "?isVote=true&moreSize=15&moreDirection=BEFORE&previousArticleId=0")
        items = [_meta_item(a) for a in data.get("contentList", []) if a.get("id")]
        return {"updatedAt": int(time.time() * 1000), "source": NEWS_PAGE, "items": items}
    return _cached("list", 600, load)


def news_article(article_id):
    def load():
        data = _fetch_json(NEWS_API + "/" + article_id)
        article = data.get("article") or {}
        item = _meta_item(article.get("contentMeta") or {})
        item["id"] = article_id
        item["url"] = NEWS_ARTICLE_URL.format(article_id)
        item["html"] = (article.get("content") or {}).get("content") or ""
        return item
    return _cached("article:" + article_id, 1800, load)

_digests = {}
_lock = threading.Lock()


def file_digest(path):
    """Short SHA-1 of a file, cached until its size or modified time changes."""
    st = path.stat()
    key = str(path)
    with _lock:
        hit = _digests.get(key)
        if hit and hit[0] == st.st_mtime_ns and hit[1] == st.st_size:
            return hit[2]
    digest = hashlib.sha1(path.read_bytes()).hexdigest()[:12]
    with _lock:
        _digests[key] = (st.st_mtime_ns, st.st_size, digest)
    return digest


def snapshot():
    """Return (build id, {relative path: digest}) for every file in public/."""
    files = {}
    for p in sorted(ROOT.rglob("*")):
        if p.is_file() and not p.name.startswith("."):
            try:
                files[p.relative_to(ROOT).as_posix()] = file_digest(p)
            except OSError:
                continue  # file is being written right now; next check picks it up
    build = hashlib.sha1(json.dumps(files, sort_keys=True).encode()).hexdigest()[:12]
    return build, files


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json",
        ".svg": "image/svg+xml",
        ".webmanifest": "application/manifest+json",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, must-revalidate")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, fmt, *args):
        if self.path.startswith("/__version"):
            return  # polled every 2 s; keep the console readable
        super().log_message(fmt, *args)

    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        if path == "/__version":
            build, files = snapshot()
            body = json.dumps({"build": build, "files": files}).encode()
            return self._send(200, body, "application/json")
        if path in ("/", "/index.html"):
            return self._send_index()
        if path == "/api/news" or path.startswith("/api/news/"):
            return self._send_news(path[len("/api/news/"):] if path.startswith("/api/news/") else "")
        return super().do_GET()

    def _send_news(self, article_id):
        if article_id and not NEWS_ID.match(article_id):
            return self._send(404, b'{"error":"unknown article"}', "application/json")
        try:
            data = news_article(article_id) if article_id else news_list()
        except Exception as exc:  # network trouble or an API change: the app shows "news unavailable"
            body = json.dumps({"error": "Could not reach the official news: %s" % exc}).encode()
            return self._send(502, body, "application/json")
        return self._send(200, json.dumps(data).encode(), "application/json")

    def _send_index(self):
        build, _ = snapshot()
        etag = '"%s"' % build
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.end_headers()
            return
        body = (ROOT / "index.html").read_bytes().replace(BUILD_TOKEN, build.encode())
        self._send(200, body, "text/html; charset=utf-8", etag)

    def _send(self, code, body, content_type, etag=None):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        if etag:
            self.send_header("ETag", etag)
        self.end_headers()
        self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description="Serve the Aion 2 Progress Tracker with live updates.")
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8080")))
    parser.add_argument("--no-browser", action="store_true", help="don't open a browser tab")
    args = parser.parse_args()

    if not (ROOT / "index.html").is_file():
        sys.exit("Could not find %s" % (ROOT / "index.html"))

    try:
        server = http.server.ThreadingHTTPServer((args.host, args.port), Handler)
    except OSError as exc:
        sys.exit("Could not start on port %d: %s\nTry: python server.py --port 8081" % (args.port, exc))

    shown_host = "localhost" if args.host in ("127.0.0.1", "0.0.0.0", "") else args.host
    url = "http://%s:%d/" % (shown_host, args.port)
    print("Aion 2 - Progress Tracker")
    print("  Serving : %s" % ROOT)
    print("  Open    : %s" % url)
    print("  Edits to files in public/ reach open pages within ~2 seconds.")
    print("  Press Ctrl+C to stop.")
    if not args.no_browser:
        threading.Timer(0.6, webbrowser.open, (url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
