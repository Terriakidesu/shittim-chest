#!/usr/bin/env python3
"""Serve dist/ the way GitHub Pages does, for local verification.

Two Pages behaviours that `vite preview` does not reproduce:

  * an extensionless URL resolves to `<name>.html` (/calendar -> calendar.html)
  * a URL with no matching file is answered with 404.html and a 404 status

The second is what public/404.html relies on, and it is otherwise impossible to
exercise locally. Usage: python3 scripts/pageslike-server.py dist 4328
"""
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = sys.argv[1]
PORT = int(sys.argv[2])


def resolve(path: str) -> str | None:
    """Map a request path to a file under ROOT, or None if there is none.

    Mirrors Pages closely enough to be useful, including the parts that are easy
    to get wrong: `/calendar` resolves to calendar.html, but `/calendar/` does
    NOT (Pages would look for calendar/index.html and 404), because a trailing
    slash makes a relative asset URL resolve one level too deep.
    """
    clean = path.split("?")[0].split("#")[0]
    if clean.endswith("/"):
        candidates = [clean + "index.html"]
    else:
        candidates = [clean, clean + ".html"]
    for candidate in candidates:
        if os.path.isfile(os.path.join(ROOT, candidate.lstrip("/"))):
            return candidate
    return None


class PagesLike(SimpleHTTPRequestHandler):
    def send_head(self):
        self.path = resolve(self.path) or "/404.html"
        head = super().send_head()
        if head and self.path == "/404.html":
            # Pages answers with the 404 document and a 404 status.
            self.send_response(404)
        return head

    def log_message(self, *args):
        pass


ThreadingHTTPServer(("127.0.0.1", PORT), partial(PagesLike, directory=ROOT)).serve_forever()
