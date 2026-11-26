"""Coto real checkout on the sandbox.

Phases are login, delivery, empty cart, shop, checkout, payment.
Delivery runs before shop. Payment uses the card saved on the Coto account.
This module does not read or send a card number. A signed noVNC URL is
written only to the log sink.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import os
import secrets
import time
from typing import Awaitable, Callable

POLL_S = 1.0
NEEDS_HUMAN_MS = 60_000
NEEDS_SHOPPER_MS = 600_000
HIDDEN_RESULT = {"admin_viewer_url", "viewerUrl", "adminViewerUrl", "ticket", "street", "pan", "password", "cvv"}


def public_job(job: dict) -> dict:
    out = {k: job.get(k) for k in ("job_id", "order_id", "status", "phase", "result", "error")}
    result = out.get("result")
    if isinstance(result, dict):
        out["result"] = {k: v for k, v in result.items() if k not in HIDDEN_RESULT}
    prompt = job.get("prompt")
    if isinstance(prompt, dict) and isinstance(prompt.get("label"), str):
        out["prompt"] = {
            "label": prompt.get("label"),
            "fieldRef": prompt.get("fieldRef") or prompt.get("field_ref"),
            "options": prompt.get("options"),
        }
    return out

Log = Callable[[str], None]
Now = Callable[[], int]
Sleep = Callable[[float], Awaitable[None]]


def phase_order_ok(phases: list[str]) -> bool:
    if "shop" not in phases:
        return True
    if "delivery" not in phases:
        return False
    return phases.index("delivery") < phases.index("shop")


# sha256(ticket) -> (job_id, expires_ms). The raw ticket is never stored or logged.
_SCREEN_TICKETS: dict[str, tuple[str, int]] = {}


def viewer_open(job) -> bool:
    return isinstance(job, dict) and job.get("status") == "running" and job.get("phase") == "needs_human"


def issue_screen_ticket(job, now: int) -> str | None:
    """Single-use screen ticket. Only while the operator still needs the Coto screen."""
    if not viewer_open(job):
        return None
    dead = [key for key, (_job_id, exp) in _SCREEN_TICKETS.items() if exp <= now]
    for key in dead:
        _SCREEN_TICKETS.pop(key, None)
    token = secrets.token_urlsafe(32)
    digest = hashlib.sha256(token.encode()).hexdigest()
    _SCREEN_TICKETS[digest] = (str(job.get("job_id") or ""), now + NEEDS_HUMAN_MS)
    return token


def consume_screen_ticket(ticket: str, job_id: str, now: int) -> bool:
    digest = hashlib.sha256(ticket.encode()).hexdigest()
    row = _SCREEN_TICKETS.get(digest)
    if row is None:
        return False
    stored, exp = row
    if now >= exp:
        _SCREEN_TICKETS.pop(digest, None)
        return False
    if stored != job_id:
        return False
    _SCREEN_TICKETS.pop(digest, None)
    return True


async def watch_coto_viewer(job, sleep: Sleep | None = None, now_ms: Now | None = None) -> None:
    """Renews viewer_seen once a second while a socket is up, and returns when the screen closes."""
    pause = sleep or asyncio.sleep
    clock = now_ms or (lambda: int(time.time() * 1000))
    while viewer_open(job):
        job["viewer_seen"] = clock()
        await pause(1)


def viewer_url(job_id: str, token: str, origin: str, exp: int, part: str = "") -> str:
    sig = hmac.new(token.encode(), f"{job_id}.{exp}".encode(), hashlib.sha256).hexdigest()
    url = f"{origin.rstrip('/')}/viewer/?job={job_id}&exp={exp}&sig={sig}"
    if part == "screen":
        url += "&part=screen"
    return url


def _fail(phase: str, code: str, phases: list[str], payment: str = "not_attempted") -> dict:
    return {
        "status": "failed",
        "phase": phase,
        "result": {
            "payment": payment,
            "store_order_id": None,
            "code": code,
            "phases": list(phases),
            "reached_payment": phase == "payment",
            "items_added": 0,
        },
    }


def _placed(order_id: str, phases: list[str]) -> dict:
    return {
        "status": "done",
        "phase": "placed",
        "result": {
            "payment": "placed",
            "store_order_id": order_id,
            "code": None,
            "phases": list(phases),
            "reached_payment": True,
            "items_added": 0,
        },
    }


async def _human(job, driver, where: str, phases, now_ms, sleep, log, token, origin) -> dict:
    job["status"] = "running"
    job["phase"] = "needs_human"
    start = now_ms()

    def deadline() -> int:
        # An operator on the screen (viewer_seen) keeps the job alive. Nobody
        # watching still times out at 60s. The shopper cap is the ceiling.
        seen = int(job.get("viewer_seen") or 0)
        renewed = max(start + NEEDS_HUMAN_MS, seen + NEEDS_HUMAN_MS)
        return min(renewed, start + NEEDS_SHOPPER_MS)

    job["viewer_exp"] = deadline()
    if token:
        url = viewer_url(str(job.get("job_id") or ""), token, origin, job["viewer_exp"], part="screen")
        log(f"phase={where} code=needs_human admin_viewer_url={url}")
    else:
        log(f"phase={where} code=needs_human")
    while now_ms() < deadline():
        job["viewer_exp"] = deadline()
        await sleep(POLL_S)
        polled = await driver.poll()
        if polled.get("placed"):
            return _placed(str(polled["placed"]), phases)
        if polled.get("declined"):
            return _fail("payment", "payment_declined", phases, "declined")
        if polled.get("fail"):
            return _fail(where, str(polled["fail"]), phases)
        if polled.get("cleared"):
            return {"cleared": True}
    log(f"phase={where} code=needs_human_timeout")
    return _fail(where, "needs_human_timeout", phases)


async def _shopper(job, driver, where, phases, now_ms, sleep, log, ask: dict) -> dict:
    job["status"] = "running"
    job["phase"] = "needs_shopper"
    field = ask.get("field_ref") or ask.get("fieldRef")
    job["prompt"] = {
        "label": ask.get("label") or "Falta un dato del pedido.",
        "fieldRef": field,
        "options": ask.get("options"),
    }
    log(f"phase={where} code=needs_shopper")
    deadline = now_ms() + NEEDS_SHOPPER_MS
    while now_ms() < deadline:
        await sleep(POLL_S)
        answer = job.get("shopper_answer")
        if (
            isinstance(answer, dict)
            and answer.get("field_ref") == field
            and isinstance(answer.get("value"), str)
            and answer["value"].strip()
        ):
            value = answer["value"].strip()
            job.pop("shopper_answer", None)
            job.pop("prompt", None)
            resumed = await driver.apply_answer(field, value)
            if resumed.get("needs_shopper"):
                return await _shopper(job, driver, where, phases, now_ms, sleep, log, resumed["needs_shopper"])
            if resumed.get("fail"):
                return _fail(where, str(resumed["fail"]), phases)
            return {"cleared": True, "field_ref": field, "value": value}
    log(f"phase={where} code=needs_shopper_timeout")
    return _fail(where, "needs_shopper_timeout", phases)


async def run_coto_real(job, driver, *, now_ms: Now, sleep: Sleep, log: Log,
                         token: str = "", origin: str = "https://sandbox.local") -> dict:
    phases: list[str] = []

    def emit(out: dict) -> dict:
        code = (out.get("result") or {}).get("code")
        if code:
            log(f"phase={out.get('phase')} code={code}")
        return out

    async def one(name: str, result: dict) -> dict | None:
        phases.append(name)
        job["phase"] = name
        if result.get("fail"):
            return _fail(name, str(result["fail"]), phases)
        if result.get("needs_human"):
            resumed = await _human(job, driver, name, phases, now_ms, sleep, log, token, origin)
            if resumed.get("cleared"):
                return None
            return resumed
        if result.get("needs_shopper"):
            resumed = await _shopper(job, driver, name, phases, now_ms, sleep, log, result["needs_shopper"])
            if not resumed.get("cleared"):
                return resumed
            if name == "delivery":
                payload = job.get("_delivery_input")
                if isinstance(payload, dict) and resumed.get("field_ref"):
                    payload[str(resumed["field_ref"])] = resumed.get("value")
                return await one("delivery", await driver.delivery(payload if isinstance(payload, dict) else {}))
            return None
        if result.get("placed"):
            return _placed(str(result["placed"]), phases)
        if result.get("declined"):
            return _fail(name, "payment_declined", phases, "declined")
        return None

    login = await one("login", await driver.login())
    if login:
        return emit(login)
    delivery_input = dict(job.get("delivery") or {})
    if not str(delivery_input.get("city") or "").strip() and str(job.get("city") or "").strip():
        delivery_input["city"] = str(job.get("city")).strip()
    delivery_input["fulfillment"] = job.get("fulfillment") or delivery_input.get("fulfillment") or "home"
    job["_delivery_input"] = delivery_input
    delivery = await one("delivery", await driver.delivery(delivery_input))
    if delivery:
        return emit(delivery)
    emptied = await one("empty_cart", await driver.empty_cart())
    if emptied:
        return emit(emptied)
    if not phase_order_ok(phases + ["shop"]):
        phases.append("shop")
        return emit(_fail("shop", "phase_order", phases))
    shopped = await one("shop", await driver.shop(job.get("items") or []))
    if shopped:
        return emit(shopped)
    checked = await one("checkout", await driver.checkout())
    if checked:
        return emit(checked)
    paid = await one("payment", await driver.payment())
    if paid:
        return emit(paid)
    return emit(_fail("payment", "payment_failed", phases))


async def coto_real_worker(job: dict) -> None:
    """Railway entry. Live browser only when COTO_REAL_LIVE=1. Otherwise the lock is refunded."""
    env = os.environ
    try:
        blocked = False
        if env.get("COTO_REAL_LIVE") != "1":
            print("coto-pay gate=COTO_REAL_LIVE", flush=True)
            blocked = True
        user = env.get("COTO_OPS_USER") or ""
        password = env.get("COTO_OPS_PASSWORD") or ""
        if not user:
            print("coto-pay gate=COTO_OPS_USER", flush=True)
            blocked = True
        if not password:
            print("coto-pay gate=COTO_OPS_PASSWORD", flush=True)
            blocked = True
        if blocked:
            job.update(**_fail("login", "ops_unavailable", []))
            return
        from coto_live import run_live

        out = await run_live(
            job,
            user=user,
            password=password,
            token=env.get("SANDBOX_TOKEN") or "",
            origin=env.get("SANDBOX_PUBLIC_URL") or "https://sandbox.local",
        )
        job.update(status=out["status"], phase=out["phase"], result=out["result"])
    except Exception:
        print("phase=login code=ops_unavailable", flush=True)
        job.update(**_fail(job.get("phase") or "login", "ops_unavailable", []))
    finally:
        job.pop("delivery", None)
        job.pop("_delivery_input", None)
        job.pop("card", None)
