"""Playwright driver for one live Coto order.

Constructed only when COTO_REAL_LIVE=1. A missing control becomes needs_human.
Nothing here logs the ops password, the street, or the card.
"""

from __future__ import annotations

import asyncio
import os
import re
import time

from coto_fields import pickup_branches, plan_delivery
from coto_real import run_coto_real


def browser_env() -> dict[str, str]:
    """Chromium on the display x11vnc serves at 127.0.0.1:5901. Same default as sandbox.py."""
    env = dict(os.environ)
    env["DISPLAY"] = os.environ.get("DISPLAY", ":99")
    return env


class LiveCotoDriver:
    def __init__(self, page, user: str, password: str):
        self.page = page
        self._user = user
        self._password = password

    def __repr__(self) -> str:
        return "LiveCotoDriver(<redacted>)"

    async def login(self) -> dict:
        await self.page.goto("https://www.coto.com.ar/ingresar", wait_until="domcontentloaded")
        user = self.page.get_by_label(re.compile(r"Documento|E-mail|Usuario", re.I))
        password = self.page.get_by_label(re.compile(r"Contraseña", re.I))
        if await user.count() == 0 or await password.count() == 0:
            return {"needs_human": True}
        await user.first.fill(self._user)
        await password.first.fill(self._password)
        button = self.page.get_by_role("button", name=re.compile(r"^Ingresar$", re.I))
        if await button.count() == 0:
            return {"needs_human": True}
        await button.first.click()
        await self.page.wait_for_timeout(1500)
        if await self._otp():
            return {"needs_human": True}
        return {"ok": True}

    async def delivery(self, address: dict) -> dict:
        await self.page.goto("https://www.coto.com.ar/agregar-domicilio", wait_until="domcontentloaded")
        if address.get("fulfillment") == "pickup":
            screen = await self._pickup_screen()
        else:
            screen = await self._delivery_screen()
        plan = plan_delivery(screen, address)
        if plan.get("needs_human") and screen.get("kind") == "unknown":
            jev = self._jev()
            if jev is not None:
                await jev.system_one(model="jev-1.13.0", screen={"kind": "unknown"})
        if plan.get("needs_shopper") or plan.get("needs_human") or plan.get("fail"):
            return plan
        if plan.get("choose_new_address"):
            fresh = self.page.get_by_role("button", name=re.compile(r"nueva direcci[oó]n|agregar direcci[oó]n", re.I))
            if await fresh.count():
                await fresh.first.click()
        for fill in plan.get("fills") or []:
            if fill.get("field") in ("meat", "pickup_branch"):
                choice = self.page.get_by_text(fill["value"], exact=True)
                if await choice.count() == 0:
                    return {"needs_shopper": {"label": str(fill["value"]), "field_ref": fill["field"], "options": None}}
                await choice.first.click()
                continue
            box = self.page.get_by_label(re.compile(re.escape(str(fill["field"])), re.I))
            if await box.count() == 0:
                return {"needs_shopper": {"label": str(fill["field"]), "field_ref": fill["field"], "options": None}}
            await box.first.fill(str(fill["value"]))
        save = self.page.get_by_role("button", name=re.compile(r"^Guardar$", re.I))
        if await save.count() == 0:
            return {"needs_human": True}
        await save.first.click()
        return {"ok": True}

    async def apply_answer(self, field_ref: str, value: str) -> dict:
        box = self.page.get_by_label(re.compile(re.escape(field_ref), re.I))
        if await box.count() == 0:
            choice = self.page.get_by_text(value, exact=True)
            if await choice.count() == 0:
                return {"fail": "needs_shopper_timeout"}
            await choice.first.click()
            return {"ok": True}
        await box.first.fill(value)
        return {"ok": True}

    async def _pickup_screen(self) -> dict:
        # Choosing the control can fail on a page that has no pickup toggle.
        # The branch list is still read; an empty list becomes needs_human.
        try:
            await self._choose_pickup_control()
        except Exception:
            pass
        try:
            rows = await self._branch_rows()
        except Exception:
            return {"kind": "pickup", "branches": []}
        return {"kind": "pickup", "branches": pickup_branches(rows)}

    async def _choose_pickup_control(self) -> None:
        pattern = re.compile(r"retiro|retirar|sucursal", re.I)
        for role in ("radio", "button"):
            control = self.page.get_by_role(role, name=pattern)
            if await control.count():
                await control.first.click()
                await self.page.wait_for_timeout(400)
                return

    async def _branch_rows(self) -> list:
        """Plain rows from the pickup radios. Overridable without a browser.

        The label is the wrapping <label> text, never the input name: radios
        that share a name would otherwise collapse into one option. Radios
        that share a name with a fulfillment toggle never reach Python.
        """
        raw = await self.page.evaluate(
            """() => {
              const mode = /^(retiro|retirar)( en sucursal| por sucursal)?$|^(env[ií]o|entrega)( a domicilio)?$|^domicilio$/;
              const linesOf = (el) => {
                const wrap = el.closest('label');
                const text = wrap ? (wrap.innerText || '') : '';
                return text.split(/\\n/).map((line) => line.trim()).filter(Boolean);
              };
              const radios = [...document.querySelectorAll('input[type="radio"], [role="radio"]')];
              const toggleNames = new Set();
              for (const el of radios) {
                const lines = linesOf(el);
                if (!lines.length || !mode.test(lines[0].toLowerCase())) continue;
                const group = el.getAttribute('name');
                if (group) toggleNames.add(group);
              }
              const rows = [];
              for (const el of radios) {
                const group = el.getAttribute('name');
                if (group && toggleNames.has(group)) continue;
                const lines = linesOf(el);
                if (!lines.length) continue;
                rows.push({ name: lines[0], address: lines.slice(1).join(' ') });
              }
              return rows;
            }"""
        )
        return raw if isinstance(raw, list) else []

    async def _delivery_screen(self) -> dict:
        try:
            meat = self.page.get_by_text("Quiero recibir un producto similar", exact=True)
            if await meat.count():
                return {"kind": "meat", "meat_options": ["Quiero recibir un producto similar"]}
            fresh = self.page.get_by_role("button", name=re.compile(r"nueva direcci[oó]n|agregar direcci[oó]n", re.I))
            if await fresh.count():
                return {"kind": "new_address", "new_address": True, "fields": {}}
        except Exception:
            return {"kind": "unknown"}
        return {"kind": "unknown"}

    def _jev(self):
        if not os.environ.get("TYPESAFE_API_KEY"):
            return None
        try:
            from typesafe_sdk import AsyncTypeSafeClient
        except Exception:
            return None
        client = AsyncTypeSafeClient()

        class Pinned:
            async def system_one(self, *, model, screen):
                return await client.system_one(state=screen, questions=[], model=model)

        return Pinned()

    async def empty_cart(self) -> dict:
        await self.page.goto("https://www.coto.com.ar/carrito", wait_until="domcontentloaded")
        return {"ok": True}

    async def shop(self, items: list) -> dict:
        for item in items:
            sku = item.get("sku") or item.get("name")
            if not sku:
                return {"fail": "sku_rejected"}
            await self.page.goto(f"https://www.coto.com.ar/producto/{sku}", wait_until="domcontentloaded")
            add = self.page.get_by_role("button", name=re.compile(r"^Agregar$", re.I))
            if await add.count() == 0:
                return {"fail": "sku_rejected"}
            await add.first.click()
        return {"ok": True}

    async def checkout(self) -> dict:
        await self.page.goto("https://www.coto.com.ar/caja", wait_until="domcontentloaded")
        return {"ok": True}

    async def payment(self) -> dict:
        if await self._cvv_visible():
            return {"needs_human": True}
        saved = self.page.get_by_role("radio", name=re.compile(r"tarjeta|visa|master|d[eé]bito|cr[eé]dito", re.I))
        if await saved.count() == 0:
            saved = self.page.get_by_role("option", name=re.compile(r"tarjeta|visa|master|d[eé]bito|cr[eé]dito", re.I))
        if await saved.count() == 0:
            return {"needs_human": True}
        await saved.first.click()
        if await self._cvv_visible():
            return {"needs_human": True}
        try:
            from checkout import complete_store_recaptcha
            outcome = await complete_store_recaptcha(self.page)
        except Exception:
            outcome = "challenge"
        if outcome == "challenge":
            return {"needs_human": True}
        pay = self.page.get_by_role("button", name=re.compile(r"^(Pagar|Confirmar compra)$", re.I))
        if await pay.count() == 0:
            return {"needs_human": True}
        await pay.first.click()
        await self.page.wait_for_timeout(1500)
        placed = await self._order_id()
        if placed:
            return {"placed": placed}
        if await self._declined():
            return {"declined": True}
        return {"needs_human": True}

    async def _cvv_visible(self) -> bool:
        field = self.page.get_by_label(re.compile(r"CVV|c[oó]digo de seguridad|security code", re.I))
        try:
            return await field.count() > 0 and await field.first.is_visible()
        except Exception:
            return False

    async def poll(self) -> dict:
        placed = await self._order_id()
        if placed:
            return {"placed": placed}
        if await self._declined():
            return {"declined": True}
        if await self._otp() or await self._challenge():
            return {"waiting": True}
        return {"cleared": True}

    async def _order_id(self) -> str | None:
        try:
            text = await self.page.locator("body").inner_text()
        except Exception:
            return None
        match = re.search(r"(?:pedido|orden)\s*(?:n[°ºo]\.?)?\s*(\d{5,})", text, re.I)
        return match.group(1) if match else None

    async def _otp(self) -> bool:
        code = self.page.get_by_label(re.compile(r"c[oó]digo", re.I))
        try:
            return await code.count() > 0 and await code.first.is_visible()
        except Exception:
            return False

    async def _challenge(self) -> bool:
        try:
            from checkout import _image_challenge
            return await _image_challenge(self.page)
        except Exception:
            return False

    async def _declined(self) -> bool:
        try:
            text = (await self.page.locator("body").inner_text()).lower()
        except Exception:
            return False
        return "rechazad" in text or "no se pudo cobrar" in text


async def run_live(job, *, user: str, password: str, token: str, origin: str) -> dict:
    from playwright.async_api import async_playwright

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=False, env=browser_env())
        page = await browser.new_page()
        try:
            driver = LiveCotoDriver(page, user, password)
            return await run_coto_real(
                job,
                driver,
                now_ms=lambda: int(time.time() * 1000),
                sleep=asyncio.sleep,
                log=lambda line: print(line, flush=True),
                token=token,
                origin=origin,
            )
        finally:
            await browser.close()
