"""Address, pickup, meat and Jev. No browser."""

import unittest

from coto_fields import JEV_MODEL, MEAT_STOCK, plan_delivery


class FakeJev:
    def __init__(self):
        self.calls = []

    def system_one(self, *, model, screen):
        self.calls.append((model, screen))
        return None


class CotoFieldsTest(unittest.TestCase):
    def test_new_address_is_filled_and_a_saved_row_is_not_a_choice(self):
        plan = plan_delivery(
            {"kind": "new_address", "new_address": True, "fields": {}},
            {"fulfillment": "home", "street": "Thames", "number": "100", "city": "Palermo", "postalCode": "1414"},
        )
        self.assertTrue(plan["choose_new_address"])
        self.assertEqual(plan["fills"][0]["value"], "Thames")
        saved = plan_delivery({"kind": "saved_addresses", "new_address": False, "saved": ["Casa"]}, {"fulfillment": "home"})
        self.assertTrue(saved.get("needs_human"))
        self.assertNotIn("Casa", str(saved))

    def test_empty_required_field_asks_and_does_not_guess(self):
        plan = plan_delivery(
            {"kind": "fields", "fields": {"butcher_notes": {"required": True, "empty": True, "label": "Notas para la carnicería"}}},
            {"fulfillment": "home", "street": "Thames", "number": "1", "city": "CABA", "postalCode": "1425"},
        )
        self.assertEqual(plan["needs_shopper"]["field_ref"], "butcher_notes")
        self.assertNotIn("fills", plan)

    def test_pickup_marks_a_branch_whose_address_contains_the_city_and_does_not_select_it(self):
        plan = plan_delivery(
            {"kind": "pickup", "branches": [
                {"name": "ABASTO", "address": "Av. Corrientes 3200, CABA"},
                {"name": "Norte", "address": "San Isidro"},
            ]},
            {"fulfillment": "pickup", "city": "CABA"},
        )
        options = plan["needs_shopper"]["options"]
        self.assertEqual(plan["needs_shopper"]["label"], "¿En qué sucursal retirás?")
        self.assertTrue(options[0]["suggested"])
        self.assertFalse(options[1]["suggested"])
        self.assertNotIn("selected", plan)

    def test_meat_uses_the_exact_stock_line_and_does_not_call_jev(self):
        client = FakeJev()
        plan = plan_delivery(
            {"kind": "meat", "meat_options": [MEAT_STOCK, "No quiero un reemplazo"]},
            {"fulfillment": "home"},
            client,
        )
        self.assertEqual(plan["fills"][0]["value"], MEAT_STOCK)
        self.assertEqual(client.calls, [])

    def test_an_unknown_screen_calls_jev_1_13_0(self):
        client = FakeJev()
        plan = plan_delivery({"kind": "unknown"}, {"fulfillment": "home"}, client)
        self.assertTrue(plan.get("needs_human"))
        self.assertEqual(client.calls[0][0], JEV_MODEL)
        self.assertEqual(JEV_MODEL, "jev-1.13.0")


if __name__ == "__main__":
    unittest.main()
