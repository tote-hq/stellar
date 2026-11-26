"""Coto real worker: phase order, AV5 log, 60s refund, no card in the result."""

import asyncio
import hashlib
import hmac
import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from coto_real import (
    NEEDS_HUMAN_MS,
    NEEDS_SHOPPER_MS,
    consume_screen_ticket,
    issue_screen_ticket,
    phase_order_ok,
    public_job,
    run_coto_real,
    viewer_url,
    watch_coto_viewer,
)


class Scripted:
    def __init__(self, steps=None, polls=None):
        self.steps = steps or {}
        self.polls = list(polls or [])
        self.calls = []

    async def _step(self, name):
        self.calls.append(name)
        return self.steps.get(name, {"ok": True})

    async def login(self):
        return await self._step("login")

    async def delivery(self, address):
        self.address = address
        self.delivery_calls = getattr(self, "delivery_calls", 0) + 1
        if self.delivery_calls > 1 and getattr(self, "answer", None):
            return {"ok": True}
        return await self._step("delivery")

    async def empty_cart(self):
        return await self._step("empty_cart")

    async def shop(self, items):
        self.items = items
        return await self._step("shop")

    async def checkout(self):
        return await self._step("checkout")

    async def payment(self):
        return await self._step("payment")

    async def poll(self):
        if self.polls:
            return self.polls.pop(0)
        return {"waiting": True}

    async def apply_answer(self, field_ref, value):
        self.answer = (field_ref, value)
        return {"ok": True}


def run(driver, logs, clock):
    async def sleep(_seconds):
        clock["t"] += 1_000

    job = {"job_id": "job1", "items": [{"name": "Leche", "quantity": 1, "sku": "1"}],
           "delivery": {"postalCode": "1425", "street": "Calle", "city": "CABA"}}
    out = asyncio.run(run_coto_real(
        job, driver, now_ms=lambda: clock["t"], sleep=sleep, log=logs.append,
        token="tok", origin="https://sandbox.example",
    ))
    return job, out


class CotoRealTest(unittest.TestCase):
    def test_delivery_runs_before_shop_and_a_placed_id_settles_the_shape(self):
        driver = Scripted({"payment": {"placed": "C-100"}})
        logs = []
        _job, out = run(driver, logs, {"t": 0})
        self.assertLess(driver.calls.index("delivery"), driver.calls.index("shop"))
        self.assertTrue(phase_order_ok(out["result"]["phases"]))
        self.assertEqual(out["status"], "done")
        self.assertEqual(out["result"]["store_order_id"], "C-100")
        self.assertNotIn("4242424242424242", json.dumps(out))
        self.assertNotIn("Calle", json.dumps(out))
        self.assertEqual(logs, [])

    def test_shop_without_delivery_is_phase_order(self):
        self.assertFalse(phase_order_ok(["login", "shop"]))
        self.assertTrue(phase_order_ok(["login", "delivery", "shop"]))

    def test_needs_human_logs_the_url_and_a_timeout_refunds(self):
        driver = Scripted({"payment": {"needs_human": True}})
        logs = []
        clock = {"t": 0}

        async def jump(_seconds):
            clock["t"] += NEEDS_HUMAN_MS + 1

        job = {"job_id": "job1", "items": [{"sku": "1"}], "delivery": {"street": "Calle"}}
        out = asyncio.run(run_coto_real(
            job, driver, now_ms=lambda: clock["t"], sleep=jump, log=logs.append,
            token="tok", origin="https://sandbox.example",
        ))
        self.assertTrue(any("code=needs_human admin_viewer_url=" in line for line in logs))
        self.assertTrue(any("&part=screen" in line for line in logs))
        self.assertTrue(any("code=needs_human_timeout" in line for line in logs))
        self.assertNotIn("admin_viewer_url", json.dumps(out))
        self.assertEqual(out["result"]["code"], "needs_human_timeout")
        shown = public_job({"job_id": "job1", "status": "failed", "phase": "payment", "result": {
            "code": "needs_human_timeout", "admin_viewer_url": "https://sandbox.example/viewer/?job=job1",
            "payment": "not_attempted", "street": "Calle", "pan": "4111111111111111",
        }})
        blob = json.dumps(shown)
        self.assertNotIn("viewer", blob)
        self.assertNotIn("Calle", blob)
        self.assertNotIn("4111", blob)
        self.assertIn("needs_human_timeout", blob)

    def test_a_cleared_challenge_can_still_place(self):
        driver = Scripted({"login": {"needs_human": True}, "payment": {"placed": "C-7"}}, polls=[{"cleared": True}])
        logs = []
        _job, out = run(driver, logs, {"t": 0})
        self.assertEqual(out["result"]["store_order_id"], "C-7")
        self.assertTrue(logs[0].startswith("phase=login code=needs_human admin_viewer_url="))

    def test_a_job_without_a_card_reaches_payment_and_places(self):
        driver = Scripted({"payment": {"placed": "C-100"}})
        logs = []
        _job, out = run(driver, logs, {"t": 0})
        self.assertIn("payment", driver.calls)
        self.assertEqual(out["status"], "done")
        self.assertEqual(out["result"]["payment"], "placed")
        self.assertEqual(out["result"]["store_order_id"], "C-100")
        self.assertNotIn("ops_unavailable", json.dumps(out))
        self.assertNotIn("fail", out["phase"])

    def test_viewer_url_is_signed_and_a_job_card_stays_off_the_public_job(self):
        url = viewer_url("abc", "tok", "https://sandbox.example", 10)
        self.assertIn("sig=", url)
        shown = public_job({
            "job_id": "job1",
            "status": "running",
            "phase": "needs_shopper",
            "card": {"pan": "4242424242424242"},
            "prompt": {"label": "¿Celular?", "fieldRef": "phone", "options": None},
        })
        blob = json.dumps(shown)
        self.assertNotIn("4242", blob)
        self.assertEqual(shown["prompt"]["label"], "¿Celular?")
        self.assertNotIn("card", shown)

    def test_coto_chromium_uses_the_vnc_display(self):
        from coto_live import browser_env

        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("DISPLAY", None)
            self.assertEqual(browser_env()["DISPLAY"], ":99")
            os.environ["DISPLAY"] = ":7"
            self.assertEqual(browser_env()["DISPLAY"], ":7")

    def test_the_deadline_renews_past_sixty_seconds_while_someone_is_watching(self):
        driver = Scripted({"payment": {"needs_human": True}})
        clock = {"t": 0}
        job = {"job_id": "job1", "items": [{"sku": "1"}], "delivery": {"street": "Calle"}}

        async def tick(_seconds):
            clock["t"] += 1_000
            if clock["t"] == 30_000:
                job["viewer_seen"] = 30_000
            if clock["t"] >= 70_000:
                driver.polls.append({"cleared": True})

        out = asyncio.run(run_coto_real(
            job, driver, now_ms=lambda: clock["t"], sleep=tick, log=lambda _line: None,
            token="tok", origin="https://sandbox.example",
        ))
        self.assertGreaterEqual(clock["t"], 61_000)
        self.assertNotEqual(out["result"]["code"], "needs_human_timeout")

    def test_a_watched_deadline_still_stops_at_the_shopper_cap(self):
        driver = Scripted({"payment": {"needs_human": True}})
        clock = {"t": 0}
        steps = {"n": 0}
        job = {
            "job_id": "job1", "items": [{"sku": "1"}], "delivery": {"street": "Calle"},
            "viewer_seen": 10**12,
        }

        async def jump(_seconds):
            steps["n"] += 1
            if steps["n"] > 3:
                raise AssertionError("deadline was not capped")
            clock["t"] = NEEDS_SHOPPER_MS + 1

        out = asyncio.run(run_coto_real(
            job, driver, now_ms=lambda: clock["t"], sleep=jump, log=lambda _line: None,
            token="tok", origin="https://sandbox.example",
        ))
        self.assertEqual(out["result"]["code"], "needs_human_timeout")
        self.assertLessEqual(steps["n"], 3)

    def test_a_screen_ticket_is_single_use_job_bound_and_stays_out_of_the_log(self):
        open_job = {"job_id": "ab" * 16, "status": "running", "phase": "needs_human", "mode": "coto_real"}
        token = issue_screen_ticket(open_job, 1_000)
        self.assertRegex(token, r"^[A-Za-z0-9_-]{40,64}$")
        self.assertFalse(consume_screen_ticket(token, "other-job", 1_001))
        self.assertTrue(consume_screen_ticket(token, open_job["job_id"], 1_001))
        self.assertFalse(consume_screen_ticket(token, open_job["job_id"], 1_001))
        self.assertIsNone(issue_screen_ticket({"status": "done", "phase": "placed"}, 1_000))
        leaked = issue_screen_ticket(open_job, 2_000)
        logs = []
        driver = Scripted({"payment": {"needs_human": True}})
        clock = {"t": 0}

        async def jump(_seconds):
            clock["t"] += NEEDS_HUMAN_MS + 1

        out = asyncio.run(run_coto_real(
            {"job_id": "job1", "items": [{"sku": "1"}], "delivery": {"street": "Calle"}},
            driver, now_ms=lambda: clock["t"], sleep=jump, log=logs.append,
            token="tok", origin="https://sandbox.example",
        ))
        blob = "\n".join(logs) + json.dumps(out) + json.dumps(public_job(open_job))
        self.assertNotIn(leaked, blob)
        self.assertNotIn("ticket=", blob)

    def test_watching_stops_when_the_job_closes(self):
        job = {"job_id": "ab" * 16, "status": "running", "phase": "needs_human", "mode": "coto_real"}
        clock = {"t": 0}

        async def tick(_seconds):
            clock["t"] += 1_000
            if clock["t"] >= 2_000:
                job["status"] = "failed"

        asyncio.run(watch_coto_viewer(job, tick, lambda: clock["t"]))
        self.assertEqual(job["viewer_seen"], 1_000)
        self.assertEqual(job["status"], "failed")

    def test_viewer_js_does_not_open_a_socket_without_a_connect_message(self):
        src = (Path(__file__).parent / "viewer" / "viewer.js").read_text()
        before, after = src.split("if (event.data?.type !== 'changuito-viewer-connect') return;", 1)
        self.assertNotIn("new RFB", before)
        self.assertIn("new RFB", after)
        self.assertNotIn("new WebSocket", src)

    def test_needs_shopper_timeout_refunds_and_a_matching_answer_resumes(self):
        driver = Scripted({"checkout": {"needs_shopper": {
            "label": "Notas para la carnicería",
            "field_ref": "butcher_notes",
            "options": None,
        }}})
        clock = {"t": 0}

        async def jump(_seconds):
            clock["t"] += NEEDS_SHOPPER_MS + 1

        job = {"job_id": "job1", "items": [{"sku": "1"}], "delivery": {"street": "Calle", "city": "CABA"}}
        out = asyncio.run(run_coto_real(
            job, driver, now_ms=lambda: clock["t"], sleep=jump, log=lambda _line: None,
            token="tok", origin="https://sandbox.example",
        ))
        self.assertEqual(out["result"]["code"], "needs_shopper_timeout")
        self.assertNotIn("4242", json.dumps(out))

        answered = Scripted({"checkout": {"needs_shopper": {
            "label": "Notas para la carnicería",
            "field_ref": "butcher_notes",
            "options": None,
        }}, "payment": {"placed": "C-9"}})
        clock2 = {"t": 0}
        job2 = {"job_id": "job2", "items": [{"sku": "1"}], "delivery": {"city": "CABA"}}

        async def reply(_seconds):
            job2["shopper_answer"] = {"field_ref": "butcher_notes", "value": "picada"}
            clock2["t"] += 1_000

        out2 = asyncio.run(run_coto_real(
            job2, answered, now_ms=lambda: clock2["t"], sleep=reply, log=lambda _line: None,
            token="", origin="https://sandbox.example",
        ))
        self.assertEqual(answered.answer, ("butcher_notes", "picada"))
        self.assertEqual(out2["result"]["store_order_id"], "C-9")

    def test_pickup_sends_the_city_without_a_street(self):
        driver = Scripted()
        clock = {"t": 0}
        job = {"job_id": "job4", "fulfillment": "pickup", "city": "CABA", "items": [{"sku": "1"}]}

        async def pause(_seconds):
            clock["t"] += 1_000

        asyncio.run(run_coto_real(
            job, driver, now_ms=lambda: clock["t"], sleep=pause, log=lambda _line: None,
            token="", origin="https://sandbox.example",
        ))
        self.assertEqual(driver.address.get("city"), "CABA")
        self.assertEqual(driver.address.get("fulfillment"), "pickup")
        self.assertNotIn("street", driver.address)
        self.assertNotIn("city", public_job(job))

    def test_a_delivery_answer_runs_delivery_again_before_shop(self):
        driver = Scripted({"delivery": {"needs_shopper": {
            "label": "¿En qué sucursal retirás?",
            "field_ref": "pickup_branch",
            "options": [{"label": "ABASTO", "value": "ABASTO"}],
        }}, "payment": {"placed": "C-3"}})
        clock = {"t": 0}
        job = {"job_id": "job3", "fulfillment": "pickup", "items": [{"sku": "1"}], "delivery": {"city": "CABA"}}

        async def reply(_seconds):
            job["shopper_answer"] = {"field_ref": "pickup_branch", "value": "ABASTO"}
            clock["t"] += 1_000

        out = asyncio.run(run_coto_real(
            job, driver, now_ms=lambda: clock["t"], sleep=reply, log=lambda _line: None,
            token="", origin="https://sandbox.example",
        ))
        self.assertEqual(driver.address.get("city"), "CABA")
        self.assertGreaterEqual(driver.delivery_calls, 2)
        self.assertEqual(driver.address.get("pickup_branch"), "ABASTO")
        self.assertLess(driver.calls.index("delivery"), driver.calls.index("shop"))
        self.assertEqual(out["result"]["store_order_id"], "C-3")


    def test_worker_prints_one_gate_line_each_and_still_fails_closed(self):
        import io
        import os
        from contextlib import redirect_stdout
        from unittest.mock import patch

        from coto_real import coto_real_worker

        job = {"job_id": "job-gates", "items": []}
        buf = io.StringIO()
        env = {"COTO_REAL_LIVE": "0", "COTO_OPS_USER": "", "COTO_OPS_PASSWORD": "present"}
        with patch.dict(os.environ, env, clear=False):
            with redirect_stdout(buf):
                asyncio.run(coto_real_worker(job))
        text = buf.getvalue()
        self.assertEqual(text.count("coto-pay gate=COTO_REAL_LIVE"), 1)
        self.assertEqual(text.count("coto-pay gate=COTO_OPS_USER"), 1)
        self.assertNotIn("coto-pay gate=job_card", text)
        self.assertNotIn("coto-pay gate=COTO_OPS_PASSWORD", text)
        self.assertNotIn("ops_unavailable", text)
        self.assertNotIn("present", text)
        self.assertEqual(job["status"], "failed")
        self.assertEqual(job["result"]["code"], "ops_unavailable")
        self.assertIsNone(job["result"]["store_order_id"])

    def test_live_off_never_calls_run_live(self):
        import os
        from unittest.mock import patch

        from coto_real import coto_real_worker

        called = {"n": 0}

        async def fake_run_live(*_args, **_kwargs):
            called["n"] += 1
            return {}

        job = {"job_id": "job-off", "items": [{"sku": "1"}]}
        env = {"COTO_REAL_LIVE": "0", "COTO_OPS_USER": "ops-user", "COTO_OPS_PASSWORD": "ops-secret"}
        with patch.dict(os.environ, env, clear=False):
            with patch("coto_live.run_live", fake_run_live):
                asyncio.run(coto_real_worker(job))
        self.assertEqual(called["n"], 0)
        self.assertEqual(job["result"]["code"], "ops_unavailable")
        self.assertNotIn("ops-secret", json.dumps(public_job(job)))

    def test_worker_places_without_a_job_card_when_live(self):
        import os
        from unittest.mock import patch

        from coto_real import coto_real_worker

        seen = {}

        async def fake_run_live(job, **kwargs):
            seen["launched"] = True
            seen["kwargs"] = kwargs
            return {
                "status": "done",
                "phase": "placed",
                "result": {
                    "payment": "placed",
                    "store_order_id": "C-100",
                    "code": None,
                    "phases": ["login", "delivery", "empty_cart", "shop", "checkout", "payment"],
                    "reached_payment": True,
                    "items_added": 1,
                },
            }

        job = {"job_id": "job-live", "items": [{"name": "Leche", "quantity": 1, "sku": "1"}]}
        env = {"COTO_REAL_LIVE": "1", "COTO_OPS_USER": "ops-user", "COTO_OPS_PASSWORD": "ops-secret"}
        with patch.dict(os.environ, env, clear=False):
            with patch("coto_live.run_live", fake_run_live):
                asyncio.run(coto_real_worker(job))
        self.assertTrue(seen.get("launched"))
        self.assertNotIn("card", seen["kwargs"])
        self.assertEqual(job["status"], "done")
        self.assertEqual(job["result"]["store_order_id"], "C-100")
        self.assertNotIn("card", job)
        self.assertNotIn("ops-secret", json.dumps(public_job(job)))

    def test_a_sentinel_card_never_appears_in_logs_or_the_public_job(self):
        sentinel = "SENTINEL-CARD-VALUE"
        driver = Scripted({"payment": {"placed": "C-100"}})
        logs = []
        clock = {"t": 0}

        async def sleep(_seconds):
            clock["t"] += 1_000

        job = {
            "job_id": "job-sentinel",
            "items": [{"sku": "1"}],
            "delivery": {"city": "CABA", "street": "Calle"},
            "card": {"pan": sentinel, "cvv": sentinel, "holder": sentinel},
        }
        out = asyncio.run(run_coto_real(
            job, driver, now_ms=lambda: clock["t"], sleep=sleep, log=logs.append,
            token="tok", origin="https://sandbox.example",
        ))
        blob = "\n".join(logs) + json.dumps(out) + json.dumps(public_job(job))
        self.assertNotIn(sentinel, blob)
        self.assertEqual(out["result"]["store_order_id"], "C-100")

    def test_payment_does_not_fill_a_card_number(self):
        import inspect
        import re

        from coto_live import LiveCotoDriver

        source = inspect.getsource(LiveCotoDriver.payment)
        self.assertNotIn("pan", source)
        self.assertNotIn(".fill(", source)

        class Loc:
            def __init__(self, page, kind, pattern, names):
                self.page = page
                self.kind = kind
                self.pattern = pattern
                self.names = names
                self.first = self

            def _matches(self):
                if self.pattern is None:
                    return bool(self.names)
                return any(self.pattern.search(name) for name in self.names)

            async def count(self):
                return 1 if self._matches() else 0

            async def is_visible(self):
                return self._matches()

            async def fill(self, value):
                label = self.pattern.pattern if hasattr(self.pattern, "pattern") else str(self.pattern)
                self.page.fills.append((label, value))

            async def click(self):
                self.page.clicks.append(self.kind)

        class Page:
            def __init__(self, labels=(), radios=(), options=()):
                self.labels = tuple(labels)
                self.radios = tuple(radios)
                self.options = tuple(options)
                self.fills = []
                self.clicks = []

            def get_by_label(self, pattern):
                return Loc(self, "label", pattern, self.labels)

            def get_by_role(self, role, name=None):
                names = self.radios if role == "radio" else self.options if role == "option" else ()
                return Loc(self, role, name, names)

        async def pay(page):
            driver = LiveCotoDriver(page, "ops-user", "ops-secret")

            class Boom(dict):
                def __getitem__(self, key):
                    raise AssertionError(key)

            driver.card = Boom()
            return await driver.payment()

        empty = Page()
        empty_out = asyncio.run(pay(empty))
        self.assertEqual(empty_out, {"needs_human": True})
        self.assertEqual(empty.fills, [])

        cvv = Page(labels=("CVV",))
        cvv_out = asyncio.run(pay(cvv))
        self.assertEqual(cvv_out, {"needs_human": True})
        self.assertEqual(cvv.fills, [])
        for label, _value in cvv.fills:
            self.assertIsNone(re.search(r"n[uú]mero de tarjeta", label, re.I))

    def test_coto_real_post_does_not_require_or_store_a_card(self):
        from pathlib import Path

        source = Path("server.py").read_text()
        branch = source.split("if body.mode == 'coto_real':", 1)[1].split("if body.shopper is None:", 1)[0]
        self.assertNotIn("card", branch)


def _sandbox_deps():
    try:
        import fastapi  # noqa: F401
    except ModuleNotFoundError:
        return False
    return True


@unittest.skipUnless(_sandbox_deps(), "sandbox dependencies are not installed; uv run python -m unittest")
class CotoRealPostTest(unittest.IsolatedAsyncioTestCase):
    async def test_post_accepts_a_job_without_a_card_and_discards_one(self):
        from server import JobIn, create, jobs

        no_card = JobIn(
            order_id="order-no-card-128",
            items=[{"name": "Leche", "quantity": 1, "sku": "1"}],
            mode="coto_real",
            fulfillment="pickup",
            city="CABA",
        )
        created = await create(no_card)
        self.assertIn("job_id", created)
        stored = jobs[created["job_id"]]
        self.assertEqual(stored["mode"], "coto_real")
        self.assertNotIn("card", stored)

        sent = "0000000000000001"
        with_card = JobIn(
            order_id="order-discard-card-128",
            items=[{"name": "Leche", "quantity": 1, "sku": "1"}],
            mode="coto_real",
            fulfillment="pickup",
            city="CABA",
            card={
                "pan": sent,
                "cvv": "000",
                "exp_month": "01",
                "exp_year": "30",
                "holder": "SENTINEL",
                "kind": "debit",
            },
        )
        created2 = await create(with_card)
        stored2 = jobs[created2["job_id"]]
        self.assertNotEqual(created2["job_id"], created["job_id"])
        self.assertNotIn("card", stored2)
        blob = json.dumps(stored2)
        self.assertNotIn(sent, blob)
        self.assertNotIn("SENTINEL", blob)
        jobs.pop(created["job_id"], None)
        jobs.pop(created2["job_id"], None)


@unittest.skipUnless(_sandbox_deps(), "sandbox dependencies are not installed; uv run python -m unittest")
class CotoViewerRouteTest(unittest.IsolatedAsyncioTestCase):
    async def test_signature_renews_while_needs_human_and_stops_when_terminal(self):
        import io
        from contextlib import redirect_stdout

        from fastapi import HTTPException

        import server

        server.TOKEN = "viewer-test-token"
        os.environ["SANDBOX_PUBLIC_URL"] = "https://sandbox.example"
        job_id = "cd" * 16
        server.jobs[job_id] = {
            "job_id": job_id,
            "mode": "coto_real",
            "status": "running",
            "phase": "needs_human",
            "viewer_exp": 1,
        }
        try:
            buf = io.StringIO()
            with redirect_stdout(buf):
                body = await server.job_viewer(job_id)
            query = parse_qs(urlsplit(body["url"]).query)
            exp = int(query["exp"][0])
            expected = hmac.new(
                server.TOKEN.encode(), f"{job_id}.{exp}".encode(), hashlib.sha256,
            ).hexdigest()
            self.assertEqual(query["sig"], [expected])
            self.assertEqual(query["part"], ["screen"])
            self.assertEqual(body["job_id"], job_id)
            self.assertRegex(body["ticket"], r"^[A-Za-z0-9_-]{40,64}$")
            self.assertNotIn(body["ticket"], body["url"])
            self.assertNotIn(body["ticket"], buf.getvalue())
            self.assertGreater(server.jobs[job_id]["viewer_seen"], 1)
            server.jobs[job_id]["status"] = "failed"
            server.jobs[job_id]["phase"] = "payment"
            with self.assertRaises(HTTPException) as caught:
                await server.job_viewer(job_id)
            self.assertEqual(caught.exception.status_code, 404)
        finally:
            server.jobs.pop(job_id, None)


if __name__ == "__main__":
    unittest.main()
