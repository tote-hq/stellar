"""Deterministic Coto screens. Jev runs only when nothing here can fill.

The meat stock line is the exact string the shopper is offered. Saved
addresses are never a choice. An empty required field becomes a question.
"""

from __future__ import annotations

import re

MEAT_STOCK = "Quiero recibir un producto similar"
JEV_MODEL = "jev-1.13.0"
PICKUP_LABEL = "¿En qué sucursal retirás?"

# Full match only, after strip and casefold. A branch such as
# "Sucursal Villa Crespo" does not match.
_FULFILLMENT_MODE = re.compile(
    r"^(retiro|retirar)( en sucursal| por sucursal)?$"
    r"|^(env[ií]o|entrega)( a domicilio)?$"
    r"|^domicilio$"
)


def pickup_branches(rows: list) -> list[dict]:
    """Rows scraped off the pickup screen. No invented names.

    A row with no name and no address is dropped. A fulfillment-mode
    label is dropped, so the pickup toggle is not a branch. The first
    row for a name wins, and the page order of the rest is kept.
    """
    out: list[dict] = []
    seen: set[str] = set()
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "").strip()
        address = str(row.get("address") or "").strip()
        if not name and not address:
            continue
        if _FULFILLMENT_MODE.fullmatch(name.casefold()):
            continue
        if name and name in seen:
            continue
        if name:
            seen.add(name)
        out.append({"name": name, "address": address})
    return out


def _needs(label: str, field_ref: str, options=None) -> dict:
    return {"needs_shopper": {"label": label, "field_ref": field_ref, "options": options}}


def _suggested(branches: list, city: str) -> list:
    needle = city.casefold().strip()
    out = []
    for branch in branches:
        address = str(branch.get("address") or "")
        name = str(branch.get("name") or address)
        out.append({
            "label": name,
            "value": name,
            "suggested": bool(needle) and needle in address.casefold(),
        })
    return out


def plan_delivery(screen: dict, order: dict, client=None) -> dict:
    """Return fills, needs_shopper, or needs_human. Never a saved address."""
    kind = screen.get("kind") or "unknown"
    fulfillment = order.get("fulfillment") or "home"
    if kind == "meat":
        options = screen.get("meat_options") or []
        if MEAT_STOCK in options:
            return {"fills": [{"field": "meat", "value": MEAT_STOCK}]}
        return _needs("¿Qué hacemos si no hay stock?", "meat", [
            {"label": option, "value": option} for option in options
        ])
    if fulfillment == "pickup" or kind == "pickup":
        chosen = order.get("pickup_branch")
        if isinstance(chosen, str) and chosen.strip():
            return {"fills": [{"field": "pickup_branch", "value": chosen.strip()}], "save": True}
        branches = pickup_branches(screen.get("branches") or [])
        options = _suggested(branches, str(order.get("city") or ""))
        if options:
            return _needs(PICKUP_LABEL, "pickup_branch", options)
        return {"needs_human": True}
    if kind in ("new_address", "saved_addresses", "fields"):
        if kind == "saved_addresses" and not screen.get("new_address"):
            return {"needs_human": True}
        missing = _empty_required(screen, order)
        if missing:
            return missing
        city_options = (screen.get("options") or {}).get("city")
        city = str(order.get("city") or "")
        if isinstance(city_options, list) and city_options:
            values = [str(item.get("value") if isinstance(item, dict) else item) for item in city_options]
            if city not in values:
                return _needs("¿Qué localidad es?", "city", [
                    {"label": value, "value": value, "suggested": False} for value in values
                ])
        fills = []
        for field, value in (
            ("street", order.get("street")),
            ("number", order.get("number")),
            ("complement", order.get("complement")),
            ("city", city),
            ("postalCode", order.get("postalCode")),
        ):
            if value:
                fills.append({"field": field, "value": str(value)})
        return {"fills": fills, "choose_new_address": True}
    if client is not None:
        client.system_one(model=JEV_MODEL, screen={"kind": kind})
        return {"needs_human": True}
    return {"needs_human": True}


def _empty_required(screen: dict, order: dict) -> dict | None:
    known = {
        "street": order.get("street"),
        "number": order.get("number"),
        "city": order.get("city"),
        "postalCode": order.get("postalCode") or order.get("postal_code"),
        "complement": order.get("complement"),
        "butcher_notes": order.get("butcher_notes"),
        "area_code": order.get("area_code"),
        "phone": order.get("phone"),
        "delivery_window": order.get("delivery_window"),
        "pickup_branch": order.get("pickup_branch"),
    }
    fields = screen.get("fields") or {}
    for name, meta in fields.items():
        if not isinstance(meta, dict) or not meta.get("required"):
            continue
        if meta.get("empty") is False:
            continue
        if known.get(name):
            continue
        label = str(meta.get("label") or name)
        options = (screen.get("options") or {}).get(name)
        return _needs(label, str(meta.get("field_ref") or name), options)
    return None
