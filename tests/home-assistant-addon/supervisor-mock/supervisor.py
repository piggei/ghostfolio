import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

TOKEN = os.environ["MOCK_TOKEN"]

OPTIONS = {
    "database_host": os.environ["MOCK_DATABASE_HOST"],
    "database_port": int(os.environ.get("MOCK_DATABASE_PORT", "5432")),
    "database_name": os.environ.get("MOCK_DATABASE_NAME", "ghostfolio_test"),
    "database_user": os.environ.get("MOCK_DATABASE_USER", "ghostfolio_test"),
    "database_pass": os.environ["MOCK_DATABASE_PASS"],
}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.respond(200, {"status": "ok"})
            return

        if self.path != "/addons/self/options/config":
            self.respond(404, {"result": "error"})
            return

        if self.headers.get("Authorization") != f"Bearer {TOKEN}":
            self.respond(401, {"result": "error"})
            return

        self.respond(200, {
            "result": "ok",
            "data": OPTIONS,
        })

        print("Authenticated Supervisor options request", flush=True)

    def respond(self, status, payload):
        body = json.dumps(payload).encode()

        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        # Never log request headers or configuration values.
        pass


HTTPServer(("0.0.0.0", 80), Handler).serve_forever()
