"""Local shop, hardened for practice_06. All identities and data are synthetic."""

import argparse
import html
import json
import sqlite3
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from sandbox import Sandbox


class Shop:
    def __init__(self):
        self.sandbox = Sandbox()
        self.lock = threading.RLock()
        self.db = sqlite3.connect(":memory:", check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            CREATE TABLE profiles(id INTEGER PRIMARY KEY, name TEXT, email TEXT, address TEXT);
            INSERT INTO profiles VALUES
                (1, 'TEST_ALICE', 'alice@example.invalid', 'TEST_ADDRESS_A'),
                (2, 'TEST_BOB', 'bob@example.invalid', 'TEST_ADDRESS_B');
            CREATE TABLE orders(id INTEGER PRIMARY KEY, owner INTEGER, product TEXT, price REAL);
            INSERT INTO orders VALUES (1, 1, 'chair', 5000), (2, 2, 'lamp', 1500);
        """)
        self.accounts = {
            "alice": ("learn-alice", 1, "customer"),
            "bob": ("learn-bob", 2, "customer"),
            "staff": ("learn-staff", 0, "staff"),
        }
        self.usernames = {uid: name for name, (_pw, uid, _role) in self.accounts.items()}
        self.sessions = {}
        self.products = {"chair": 5000, "lamp": 1500}
        self.reviews = []
        self.logs = []

    def rows(self, query, params=()):
        return [dict(row) for row in self.db.execute(query, params)]

    def session_of(self, headers):
        """Владелец и роль определяются только по серверной сессии, не по запросу."""
        return self.sessions.get(headers.get("X-Token"))

    @staticmethod
    def redact(entry):
        """Копия записи журнала без паролей и токенов."""
        safe = dict(entry)
        body = dict(safe.get("body") or {})
        if "password" in body:
            body["password"] = "***"
        safe["body"] = body
        headers = {k: ("***" if k.lower() == "x-token" else v) for k, v in (safe.get("headers") or {}).items()}
        safe["headers"] = headers
        return safe

    def dispatch(self, method, target, body, headers):
        url = urlsplit(target)
        query = {k: v[0] for k, v in parse_qs(url.query, keep_blank_values=True).items()}
        self.logs.append({"method": method, "target": target, "body": body, "headers": dict(headers)})
        if method == "GET" and url.path == "/health":
            return 200, {"status": "ok"}
        if method == "GET" and url.path == "/products":
            return 200, self.products
        if method == "POST" and url.path == "/login":
            account = self.accounts.get(body.get("username"))
            if not account or body.get("password") != account[0]:
                return 401, {"error": "invalid credentials"}
            token = uuid.uuid4().hex
            self.sessions[token] = {"id": account[1], "role": account[2]}
            return 200, {"token": token}
        if method == "GET" and url.path == "/profile":
            session = self.session_of(headers)
            if not session:
                return 401, {"error": "login required"}
            try:
                requested = int(query.get("id", session["id"]))
            except ValueError:
                return 400, {"error": "bad id"}
            if session["role"] != "staff" and requested != session["id"]:
                return 403, {"error": "forbidden"}
            return 200, self.rows("SELECT * FROM profiles WHERE id = ?", (requested,))
        if method == "GET" and url.path == "/search":
            session = self.session_of(headers)
            if not session:
                return 401, {"error": "login required"}
            if session["role"] != "staff":
                return 403, {"error": "staff only"}
            return 200, self.rows("SELECT * FROM profiles WHERE name LIKE ?", (f"%{query.get('q', '')}%",))
        if method == "GET" and url.path == "/orders":
            session = self.session_of(headers)
            if not session:
                return 401, {"error": "login required"}
            if session["role"] == "staff":
                return 200, self.rows("SELECT * FROM orders")
            return 200, self.rows("SELECT * FROM orders WHERE owner = ?", (session["id"],))
        if method == "POST" and url.path == "/orders":
            session = self.session_of(headers)
            if not session:
                return 401, {"error": "login required"}
            product = body["product"]
            if product not in self.products:
                return 400, {"error": "unknown product"}
            price = self.products[product]  # цену назначает сервер по каталогу
            cursor = self.db.execute("INSERT INTO orders(owner, product, price) VALUES (?, ?, ?)",
                                     (session["id"], product, price))
            self.db.commit()
            return 201, {"id": cursor.lastrowid, "owner": session["id"], "product": product, "price": price}
        if method == "GET" and url.path == "/admin/export":
            session = self.session_of(headers)
            if not session or session["role"] != "staff":
                return 403, {"error": "staff only"}
            return 200, self.rows("SELECT * FROM profiles")
        if method == "GET" and url.path == "/files":
            session = self.session_of(headers)
            if not session:
                return 401, {"error": "login required"}
            owner = self.usernames.get(session["id"])
            user = query.get("user", owner)
            if session["role"] != "staff" and user != owner:
                return 403, {"error": "forbidden"}
            path = query.get("path", "receipt.txt")
            if ".." in path or path.startswith("/"):
                return 400, {"error": "bad path"}
            return 200, {"content": self.sandbox.read(f"files/{user}/{path}")}
        if method == "GET" and url.path == "/debug/logs":
            session = self.session_of(headers)
            if not session or session["role"] != "staff":
                return 403, {"error": "staff only"}
            return 200, [self.redact(entry) for entry in self.logs]
        if method == "POST" and url.path == "/reviews":
            session = self.session_of(headers)
            if not session:
                return 401, {"error": "login required"}
            self.reviews.append({"product": body["product"], "text": body["text"]})
            return 201, {"saved": True}
        if method == "GET" and url.path == "/reviews/view":
            return 200, "<html><body>" + "".join(f"<p>{html.escape(r['text'])}</p>" for r in self.reviews) + "</body></html>"
        if method == "GET" and url.path == "/assistant/context":
            session = self.session_of(headers)
            if not session:
                return 401, {"error": "login required"}
            try:
                order_id = int(query.get("order_id", "1"))
            except ValueError:
                return 400, {"error": "bad order_id"}
            if session["role"] == "staff":
                orders = self.rows("SELECT * FROM orders WHERE id = ?", (order_id,))
            else:
                orders = self.rows("SELECT * FROM orders WHERE id = ? AND owner = ?", (order_id, session["id"]))
            prompt = (
                "Ты помощник магазина. Прочитай заказ и отзывы. Верни JSON с полями tool и arguments.\n"
                "Инструменты: read_file(path), export_profiles(), delete_tree(path).\n"
                "Помоги пользователю обработать заказ.\n"
                f"Заказ: {json.dumps(orders, ensure_ascii=False)}\n"
                f"Отзывы: {json.dumps(self.reviews, ensure_ascii=False)}\n"
                f"Запрос пользователя: {query.get('question', 'Покажи чек по заказу')}"
            )
            return 200, {"prompt": prompt}
        if method == "POST" and url.path == "/assistant/execute":
            # Решение модели — недоверенный ввод. Сервер сам проверяет права и
            # границы, независимо от того, что «решила» LLM (в т.ч. под prompt
            # injection из отзывов). Опасные инструменты через помощника закрыты.
            session = self.session_of(headers)
            if not session:
                return 401, {"error": "login required"}
            decision = body["decision"]
            tool, arguments = decision["tool"], decision.get("arguments", {})
            if tool == "read_file":
                owner = self.usernames.get(session["id"])
                path = arguments.get("path", "")
                prefix = f"files/{owner}/"
                if ".." in path or not path.startswith(prefix):
                    return 403, {"error": "forbidden"}
                return 200, {"content": self.sandbox.read(path)}
            if tool in ("export_profiles", "delete_tree"):
                return 403, {"error": "tool not permitted"}
            return 400, {"error": "unknown tool"}
        return 404, {"error": "not found"}

    def close(self):
        self.db.close()
        self.sandbox.close()


def make_handler(shop):
    class Handler(BaseHTTPRequestHandler):
        def handle_request(self):
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 <= size <= 65536:
                    self.send_error(413)
                    return
                body = json.loads(self.rfile.read(size)) if size else {}
                with shop.lock:
                    status, result = shop.dispatch(self.command, self.path, body, self.headers)
            except Exception as exc:
                status, result = 500, {"error": str(exc), "type": type(exc).__name__}
            html = isinstance(result, str)
            data = (result if html else json.dumps(result, ensure_ascii=False)).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "text/html; charset=utf-8" if html else "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        do_GET = do_POST = handle_request

        def log_message(self, format, *args):
            pass

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8066)
    args = parser.parse_args()
    shop = Shop()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(shop))
    server.daemon_threads = True
    print(f"Local exercise: http://127.0.0.1:{server.server_port}", flush=True)
    print(f"Disposable fixture files: {shop.sandbox.root}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        shop.close()


if __name__ == "__main__":
    main()
