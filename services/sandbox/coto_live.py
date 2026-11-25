"""Playwright driver for one live Coto order.

Constructed only when COTO_REAL_LIVE=1. A missing control becomes needs_human.
Nothing here logs the ops password, the street, or the card.
"""

from __future__ import annotations

import asyncio
import re
import time

from coto_real import run_coto_real


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
        box = self.page.get_by_placeholder(re.compile(r"calle", re.I))
        if await box.count() == 0:
            return {"needs_human": True}
        text = " ".join(
            part for part in (address.get("street"), address.get("number"), address.get("city")) if part
        )
        await box.first.fill(text)
        # The map confirmation is a human step. Poll resumes once it is gone.
        return {"needs_human": True}

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

    async def payment(self, card: dict) -> dict:
        number = self.page.get_by_label(re.compile(r"N[uú]mero de tarjeta", re.I))
        if await number.count() == 0:
            return {"needs_human": True}
        await number.first.fill(card["pan"])
        holder = self.page.get_by_label(re.compile(r"Nombre", re.I))
        if await holder.count():
            await holder.first.fill(card.get("holder") or "")
        exp = self.page.get_by_label(re.compile(r"Vencimiento", re.I))
        if await exp.count():
            await exp.first.fill(f"{card.get('exp_month', '')}/{card.get('exp_year', '')}")
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


async def run_live(job, *, user: str, password: str, card: dict, token: str, origin: str) -> dict:
    from playwright.async_api import async_playwright

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=False)
        page = await browser.new_page()
        try:
            driver = LiveCotoDriver(page, user, password)
            return await run_coto_real(
                job,
                driver,
                now_ms=lambda: int(time.time() * 1000),
                sleep=asyncio.sleep,
                log=lambda line: print(line, flush=True),
                card=card,
                token=token,
                origin=origin,
            )
        finally:
            await browser.close()
