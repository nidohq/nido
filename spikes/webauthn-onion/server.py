#!/usr/bin/env python3
"""Static server for the WebAuthn onion spike.

Serves index.html on every path and vhost (so subdomain origins get the same
page), plus /whoami echoing the Host header the server actually received —
proving the subdomain label survives the Tor hop.

HTTP on :18080 always; HTTPS on :18443 when certs/leaf.pem exists (gen-cert.sh).
"""

import json
import ssl
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PAGE = (ROOT / "index.html").read_bytes()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/whoami"):
            body = json.dumps(
                {
                    "host_header": self.headers.get("Host", ""),
                    "scheme": "https" if isinstance(self.connection, ssl.SSLSocket) else "http",
                    "path": self.path,
                }
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
        else:
            body = PAGE
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        sys.stderr.write(
            "%s %s Host=%s\n" % (self.address_string(), fmt % args, self.headers.get("Host", "?"))
        )


def serve_http():
    ThreadingHTTPServer(("127.0.0.1", 18080), Handler).serve_forever()


def serve_https():
    cert, key = ROOT / "certs/leaf.pem", ROOT / "certs/leaf.key"
    if not cert.exists():
        print("no certs/leaf.pem — https :18443 disabled (run ./gen-cert.sh)", file=sys.stderr)
        return
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert, key)
    httpd = ThreadingHTTPServer(("127.0.0.1", 18443), Handler)
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    httpd.serve_forever()


if __name__ == "__main__":
    threading.Thread(target=serve_https, daemon=True).start()
    print("serving http on 127.0.0.1:18080 (and :18443 if certs exist)", file=sys.stderr)
    serve_http()
