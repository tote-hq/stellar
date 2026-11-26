---
name: changuito-design
description: Design rules for changuito's web UI (apps/web). Use before adding or changing a modal, its close control, or the logout button.
---

# changuito design rules

Tokens live at the top of `apps/web/app/globals.css`. Use them. Do not add new colors.

## A modal closes with an X in the top-right

- Every modal has one close control: an X (`×`) in the top-right corner of its
  header. Use `className="modal-x"` inside a `modal-head` header, as
  `components/Modal.tsx` does. Prefer `Modal.tsx` for a new modal.
- The X keeps an accessible name. `aria-label` stays «Cerrar» (or «Close» in
  English), from the copy the modal already uses.
- `.modal-x` gives a 44px by 44px target. Do not shrink it.
- Do not also show a «Cerrar» button at the bottom of the modal. A second
  close control repeats the X and pushes the main action down.
- Clicking the backdrop can still close the modal.

## Logout is a solid red button

- Logout (`data-testid="wallet-logout"` in `components/ProfileModal.tsx`) uses
  `className="btn btn-logout"`: a solid `--chg-arcilla` fill with
  `--chg-espresso` text.
- Espresso on arcilla is 5.67:1. White on arcilla is 2.95:1 and fails
  contrast, so do not put white text on it.
- Do not make logout a white or transparent button with a red border
  (`btn-ghost`, `btn-warn`).
- Logout keeps a visible text label and the 44px minimum height from `.btn`.
