"""Playwright driver for one live Coto order.

Constructed only when COTO_REAL_LIVE=1. A missing control becomes needs_human.
Nothing here logs the ops password, the street, or the card.
"""

from __future__ import annotations

import asyncio
import os
import re
import time
import unicodedata
from urllib.parse import quote, urljoin

from coto_fields import pickup_branches, plan_delivery
from coto_real import run_coto_real

_COTO_PREFIX = "https://www.coto.com.ar/"
_ADD_WAIT_MS = 10_000
# Exact cart labels only. A word boundary after Agregar also matches
# "Agregar a favoritos" and "Agregar a mi lista".
_ADD_BUTTON = re.compile(r"^\s*Agregar(?: al carrito)?\s*$", re.I)
_UNIT_GAP = re.compile(r"(\d)\s+([a-z]+)\b")


def _sku_rejected(line: str) -> dict:
    failed = {"fail": "sku_rejected"}
    if line:
        failed["line"] = line
    return failed


def _norm_name(text: str) -> str:
    """Case, accents, whitespace, and a unit glued to its number (`1 l` = `1l`)."""
    folded = unicodedata.normalize("NFKD", text)
    folded = "".join(ch for ch in folded if not unicodedata.combining(ch))
    folded = folded.casefold()
    folded = re.sub(r"\s+", " ", folded).strip()
    return _UNIT_GAP.sub(r"\1\2", folded)


def _is_name_search(url: str) -> bool:
    return url.startswith(_COTO_PREFIX) and "/search?" in url and "Ntt=" in url


def _product_target(item: dict) -> str | None:
    """Catalog page when it is on the Coto storefront. Otherwise a name search.

    A slug is never built from the sku. An off-domain url is not opened.
    """
    url = item.get("url")
    if isinstance(url, str) and url.strip().startswith(_COTO_PREFIX):
        return url.strip()
    name = item.get("name")
    if isinstance(name, str) and name.strip():
        return "https://www.coto.com.ar/search?Ntt=" + quote(name.strip(), safe="")
    return None


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
        self._fulfillment = "home"
        self._branch_seen = False
        self._added: set[str] = set()
        self._pending_line: str | None = None

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
        fulfillment = address.get("fulfillment")
        self._fulfillment = fulfillment if fulfillment in ("home", "pickup") else "home"
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
                if fill.get("field") == "pickup_branch":
                    self._branch_seen = True
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
            if field_ref == "pickup_branch":
                self._branch_seen = True
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
            if not isinstance(item, dict):
                return {"fail": "sku_rejected"}
            name = item.get("name")
            line = name.strip() if isinstance(name, str) else ""
            key = _norm_name(line) if line else ""
            if key and key in self._added:
                continue
            target = _product_target(item)
            if target is None:
                return _sku_rejected(line)
            await self.page.goto(target, wait_until="domcontentloaded")
            if _is_name_search(target):
                if not await self._open_named_result(line):
                    # A search page with no row for this name is not a rejection.
                    # The product page is what can be missing an add control.
                    self._pending_line = line
                    return {"needs_human": True}
            add = self.page.get_by_role("button", name=_ADD_BUTTON)
            try:
                await add.first.wait_for(state="visible", timeout=_ADD_WAIT_MS)
            except Exception:
                return _sku_rejected(line)
            await add.first.click()
            if key:
                self._added.add(key)
        return {"ok": True}

    async def _open_named_result(self, line: str) -> bool:
        """Open the result whose visible name is this line. Never a different product."""
        wanted = _norm_name(line)
        if not wanted:
            return False
        try:
            rows = await self.page.evaluate(
                """() => [...document.querySelectorAll('a[href]')].map((a) => ({
                  name: (a.innerText || a.textContent || '').trim(),
                  href: a.getAttribute('href') || ''
                }))"""
            )
        except Exception:
            return False
        if not isinstance(rows, list):
            return False
        for row in rows:
            if not isinstance(row, dict):
                continue
            label = row.get("name")
            href = row.get("href")
            if not isinstance(label, str) or not isinstance(href, str) or not href.strip():
                continue
            if _norm_name(label) != wanted:
                continue
            absolute = urljoin(_COTO_PREFIX, href.strip())
            if not absolute.startswith(_COTO_PREFIX):
                continue
            await self.page.goto(absolute, wait_until="domcontentloaded")
            return True
        return False

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

    async def poll(self, where: str | None = None) -> dict:
        # Delivery stays open until the pickup or address screen is actually done.
        # Payment signals (an order id, a decline, a one-time code) must not clear it.
        if where == "delivery":
            if await self._delivery_done():
                return {"cleared": True}
            return {"waiting": True}
        if where == "shop":
            if await self._shop_cleared():
                return {"cleared": True}
            return {"waiting": True}
        placed = await self._order_id()
        if placed:
            return {"placed": placed}
        if await self._declined():
            return {"declined": True}
        if await self._otp() or await self._challenge():
            return {"waiting": True}
        return {"cleared": True}

    def _left_delivery_page(self) -> bool:
        try:
            url = self.page.url
        except Exception:
            return False
        if not isinstance(url, str) or not url.startswith("http"):
            return False
        return "agregar-domicilio" not in url

    async def _branch_chosen(self) -> bool:
        try:
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
                  for (const el of radios) {
                    const group = el.getAttribute('name');
                    if (group && toggleNames.has(group)) continue;
                    const checked = el.checked === true || el.getAttribute('aria-checked') === 'true';
                    if (!checked) continue;
                    const lines = linesOf(el);
                    if (!lines.length || mode.test(lines[0].toLowerCase())) continue;
                    return true;
                  }
                  return false;
                }"""
            )
        except Exception:
            return False
        return raw is True

    async def _page_text(self) -> str:
        try:
            return await self.page.locator("body").inner_text()
        except Exception:
            return ""

    def _on_cart(self) -> bool:
        try:
            url = self.page.url
        except Exception:
            return False
        return isinstance(url, str) and "/carrito" in url

    async def _shop_cleared(self) -> bool:
        pending = self._pending_line
        if not isinstance(pending, str) or not pending.strip():
            return False
        if not self._on_cart():
            return False
        if _norm_name(pending) not in _norm_name(await self._page_text()):
            return False
        self._added.add(_norm_name(pending))
        self._pending_line = None
        return True

    async def _delivery_done(self) -> bool:
        # Pickup stays open until a branch was actually chosen. Leaving
        # agregar-domicilio with nothing checked used to look like success
        # and the line was then refunded.
        chosen = await self._branch_chosen()
        if chosen:
            self._branch_seen = True
        if self._fulfillment == "pickup":
            if chosen:
                return True
            return self._branch_seen and self._left_delivery_page()
        if self._left_delivery_page():
            return True
        return chosen

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
