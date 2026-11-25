"""Coto real worker: phase order, AV5 log, 60s refund, no card in the result."""

import asyncio
import json
import unittest

from coto_real import (
    NEEDS_HUMAN_MS,
    NEEDS_SHOPPER_MS,
    load_ops_card,
    phase_order_ok,
    public_job,
    run_coto_real,
    viewer_url,
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

    async def payment(self, card):
        self.card = card
        return await self._step("payment")

    async def poll(self):
        if self.polls:
            return self.polls.pop(0)
        return {"waiting": True}

    async def apply_answer(self, field_ref, value):
        self.answer = (field_ref, value)
        return {"ok": True}


def run(driver, card, logs, clock):
    async def sleep(_seconds):
        clock["t"] += 1_000

    job = {"job_id": "job1", "items": [{"name": "Leche", "quantity": 1, "sku": "1"}],
           "delivery": {"postalCode": "1425", "street": "Calle", "city": "CABA"}}
    out = asyncio.run(run_coto_real(
        job, driver, now_ms=lambda: clock["t"], sleep=sleep, log=logs.append, card=card,
        token="tok", origin="https://sandbox.example",
    ))
    return job, out


class CotoRealTest(unittest.TestCase):
    def test_delivery_runs_before_shop_and_a_placed_id_settles_the_shape(self):
        driver = Scripted({"payment": {"placed": "C-100"}})
        logs = []
        _job, out = run(driver, {"pan": "4242424242424242"}, logs, {"t": 0})
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
            card={"pan": "4111111111111111"}, token="tok", origin="https://sandbox.example",
        ))
        self.assertTrue(any("code=needs_human admin_viewer_url=" in line for line in logs))
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
        _job, out = run(driver, {"pan": "4242424242424242"}, logs, {"t": 0})
        self.assertEqual(out["result"]["store_order_id"], "C-7")
        self.assertTrue(logs[0].startswith("phase=login code=needs_human admin_viewer_url="))

    def test_missing_card_does_not_place(self):
        _job, out = run(Scripted(), None, [], {"t": 0})
        self.assertEqual(out["result"]["code"], "ops_unavailable")
        self.assertIsNone(out["result"]["store_order_id"])

    def test_viewer_url_is_signed_and_env_card_json_is_ignored(self):
        url = viewer_url("abc", "tok", "https://sandbox.example", 10)
        self.assertIn("sig=", url)
        self.assertIsNone(load_ops_card({}))
        self.assertIsNone(load_ops_card({"COTO_SHARED_CARD_JSON": '{"pan":"4242424242424242"}'}))
        self.assertEqual(load_ops_card({"card": {"pan": "4242424242424242"}})["pan"], "4242424242424242")
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
            card={"pan": "4242424242424242"}, token="tok", origin="https://sandbox.example",
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
            card={"pan": "4242424242424242"}, token="", origin="https://sandbox.example",
        ))
        self.assertEqual(answered.answer, ("butcher_notes", "picada"))
        self.assertEqual(out2["result"]["store_order_id"], "C-9")

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
            card={"pan": "4242424242424242"}, token="", origin="https://sandbox.example",
        ))
        self.assertGreaterEqual(driver.delivery_calls, 2)
        self.assertEqual(driver.address.get("pickup_branch"), "ABASTO")
        self.assertLess(driver.calls.index("delivery"), driver.calls.index("shop"))
        self.assertEqual(out["result"]["store_order_id"], "C-3")


if __name__ == "__main__":
    unittest.main()
