"""Регрессия на угрозы из THREAT_MODEL.md.

Каждый тест утверждает БЕЗОПАСНОЕ поведение сервиса. На исходном уязвимом
service.py они падают — это доказательство дыры (проблема видна до фикса).
После исправления service.py все тесты обязаны стать зелёными, а поставляемые
функциональные тесты (test_service.py, test_http.py) — продолжать проходить.
"""

import unittest

from service import Shop


class SecurityTest(unittest.TestCase):
    def setUp(self):
        self.shop = Shop()
        self.addCleanup(self.shop.close)

    def request(self, method, path, body=None, headers=None):
        with self.shop.lock:
            return self.shop.dispatch(method, path, body or {}, headers or {})

    def login(self, username="alice", password="learn-alice"):
        status, result = self.request("POST", "/login", {"username": username, "password": password})
        self.assertEqual(status, 200)
        return {"X-Token": result["token"]}

    # T1 — подмена роли через клиентский заголовок X-Role
    def test_t1_role_header_cannot_grant_staff(self):
        auth = {**self.login(), "X-Role": "staff"}  # alice — обычный клиент
        status, _ = self.request("GET", "/admin/export", headers=auth)
        self.assertEqual(status, 403, "X-Role из запроса не должен давать права сотрудника")

    # T2 — подмена цены заказа из тела запроса
    def test_t2_price_is_taken_from_catalog(self):
        status, order = self.request("POST", "/orders", {"product": "chair", "price": 1}, self.login())
        self.assertEqual(status, 201)
        self.assertEqual(order["price"], 5000, "цена должна браться из каталога, а не из тела")

    # T3 — журнал запросов открыт и содержит секреты
    def test_t3_debug_logs_not_public(self):
        status, _ = self.request("GET", "/debug/logs")
        self.assertIn(status, (401, 403, 404), "журнал не должен быть доступен анонимно")

    # T4 — чтение чужого профиля (ПДн, 152-ФЗ)
    def test_t4_cannot_read_other_profile(self):
        status, body = self.request("GET", "/profile?id=2", headers=self.login())  # alice просит профиль bob
        leaked = status == 200 and any(row.get("name") == "TEST_BOB" for row in body)
        self.assertFalse(leaked, "клиент не должен видеть чужой профиль")

    def test_t4_profile_requires_auth(self):
        status, _ = self.request("GET", "/profile?id=1")
        self.assertIn(status, (401, 403), "профиль без сессии отдавать нельзя")

    # T5 — SQL-инъекция в параметрах
    def test_t5_profile_id_injection_contained(self):
        status, body = self.request("GET", "/profile?id=0 OR 1=1", headers=self.login())
        dumped = status == 200 and isinstance(body, list) and len(body) > 1
        self.assertFalse(dumped, "инъекция в id не должна выгружать все строки")

    def test_t5_search_injection_contained(self):
        status, body = self.request("GET", "/search?q=%27%20OR%20%271%27%3D%271", headers=self.login())
        dumped = status == 200 and isinstance(body, list) and len(body) > 1
        self.assertFalse(dumped, "инъекция в q не должна выгружать все строки")

    # T6 — IDOR по файлам: чужой чек и служебная заметка
    def test_t6_cannot_read_other_users_receipt(self):
        status, body = self.request("GET", "/files?user=bob&path=receipt.txt", headers=self.login())
        leaked = status == 200 and "TEST_BOB" in (body or {}).get("content", "")
        self.assertFalse(leaked, "клиент не должен читать чужой чек")

    def test_t6_cannot_read_operator_note(self):
        status, body = self.request("GET", "/files?user=..&path=private/operator-note.txt", headers=self.login())
        leaked = status == 200 and "OPERATOR_SECRET" in (body or {}).get("content", "")
        self.assertFalse(leaked, "служебная заметка клиенту недоступна")

    # T7 — прямой вызов привилегированных инструментов помощника
    def test_t7_customer_cannot_export_profiles_via_assistant(self):
        status, body = self.request("POST", "/assistant/execute", {
            "decision": {"tool": "export_profiles", "arguments": {}}
        }, self.login())
        exported = status == 200 and isinstance(body, list) and len(body) >= 1
        self.assertFalse(exported, "клиент не должен выгружать все профили через помощника")

    # T7/T10 — разрушение данных через delete_tree
    def test_t7_customer_cannot_delete_tree(self):
        status, _ = self.request("POST", "/assistant/execute", {
            "decision": {"tool": "delete_tree", "arguments": {"path": "."}}
        }, self.login())
        self.assertIn(status, (400, 403), "delete_tree не должен быть доступен клиенту")

    def test_t7_cannot_read_other_file_via_assistant(self):
        status, body = self.request("POST", "/assistant/execute", {
            "decision": {"tool": "read_file", "arguments": {"path": "files/bob/receipt.txt"}}
        }, self.login())
        leaked = status == 200 and "TEST_BOB" in (body or {}).get("content", "")
        self.assertFalse(leaked, "через помощника нельзя читать чужой файл")

    # T8 — защита сервера не зависит от послушания модели: даже «решение»
    # удалить/выгрузить, пришедшее как валидный JSON, сервер обязан отклонить.
    def test_t8_server_blocks_dangerous_forced_decision(self):
        for tool in ("delete_tree", "export_profiles"):
            with self.subTest(tool=tool):
                status, _ = self.request("POST", "/assistant/execute", {
                    "decision": {"tool": tool, "arguments": {"path": "."}}
                }, self.login())
                self.assertIn(status, (400, 403), "опасное решение модели должно блокироваться сервером")

    # T9 — stored XSS в просмотре отзывов
    def test_t9_review_output_is_escaped(self):
        auth = self.login()
        self.request("POST", "/reviews", {"product": "chair", "text": "<script>alert(1)</script>"}, auth)
        _, html = self.request("GET", "/reviews/view", headers=auth)
        self.assertNotIn("<script>", html, "текст отзыва должен экранироваться в HTML")


if __name__ == "__main__":
    unittest.main()
