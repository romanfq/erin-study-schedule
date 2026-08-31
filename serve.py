#!/usr/bin/env python3
"""Local preview server with single-page-app fallback.

Serves the repo at http://localhost:8000 and falls back to index.html for
unknown paths, so clean routes like /maths/circles work exactly as they do
on GitHub Pages. Run:  python3 serve.py
"""
import http.server
import os
import socketserver

PORT = int(os.environ.get("PORT", "8000"))
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        path = self.path.split("?", 1)[0].split("#", 1)[0]
        full = os.path.join(ROOT, path.lstrip("/"))
        # Serve real files/dirs; otherwise hand the SPA its index.html.
        if path != "/" and not os.path.exists(full):
            self.path = "/index.html"
        return super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Serving {ROOT}\n  → http://localhost:{PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
