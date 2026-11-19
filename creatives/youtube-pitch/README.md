# Changuito — YouTube video 16:9

Horizontal brand film, 1920×1080, 30 fps, 88 seconds. Made with
[Remotion](https://www.remotion.dev). There is no voice: Simoneth records the
narration separately. The music sits low on purpose so that voice has room.

The project lives only in this folder. It imports nothing from `apps/web` or
`apps/landing`.

## Render

```console
cd creatives/youtube-pitch
npm install
npx remotion render YouTubePitch out/changuito-youtube-pitch.mp4
```

`npm run render` does the same. The codec comes from `remotion.config.ts`: H.264,
yuv420p, BT.709, CRF 18. The first time, Remotion downloads Chrome Headless Shell.

| Command | What it does |
|---|---|
| `npm run dev` | Remotion Studio. The composition and each scene, under **Escenas** |
| `npm run frames` | Review stills in `out/frames/` |
| `npm run audio` | Synthesizes the bed and the effects again |
| `npm run contrast` | WCAG contrast of the text/background pairs |
| `npm run lint` | ESLint and `tsc` |

`out/` is not committed. The MP4 and the PNGs in `out/frames/` ship with the PR.

## Storyboard

Durations are in `src/timeline.json`.

| # | Scene | Duration | What you see |
|---|---|---|---|
| 1 | `Title` | 6 s | Wordmark, idle mascot, «Armá el súper sin pensar.», www.changuito.me |
| 2 | `Insight` | 10 s | The supermarket as a second job: list, prices, minutes |
| 3 | `Promesa` | 8 s | It builds the shop for you. Not an exchange and not a comparison site |
| 4 | `Demo` | 28 s | The product in motion: chat, prices, cart. No "how it works" slides |
| 5 | `Pago` | 25 s | «Pagás con USDC en Stellar. Nosotros nos encargamos de que lo acepte el supermercado.» Pollar wallet, funding, temporary card, charge and discard, or the card you already have |
| 6 | `Cta` | 11 s | Join the beta · www.changuito.me/whitelist · app.changuito.me |

Cuts are covered by a panel (`src/components/Swipe.tsx`) as an overlay of
`TransitionSeries`, so the duration is the sum of the scenes. The one that
enters the CTA uses the mate + bread pattern.

## Brand

- Colors: off-white `#FAFAF7`, espresso `#2A1A14`, sunflower `#F4B942`, clay `#E07A5F`.
- «Changuito» appears only as the wordmark PNG (`public/brand/wordmark@2x.png`).
- Mascot: idle, comparing and full poses from the brand pack. The X-eyes pose and the discarded success pose are not used.
- Inter is in `public/fonts` (SIL OFL). The render does not need the network for type.
- Copy is Rioplatense Spanish, with voseo. The supermarkets are «Súper A/B/C/D»: no chain is named.

## Audio

`scripts/make-audio.mjs` synthesizes a bed at 120 BPM and seven effects
(`pop`, `tick`, `tap`, `whoosh`, `impact`, `ding`, `success`). There are no
samples and no voice. The drop lands on the cut to `Promesa`, there is a short
breakdown entering `Pago`, and the outro starts with the CTA. In the composition
the bed volume stays at 0.26 so the voiceover can come in later without fighting it.

If you change durations in `src/timeline.json`, run `npm run audio`.

## Accessibility

A video cannot be scanned with axe-core. `npm run contrast` measures each
text/background pair against WCAG 2.1 SC 1.4.3 (AA). There is no speech in the
file: everything that matters is written on screen. Nothing flashes more than
three times per second (SC 2.3.1). Important type stays inside a 96 px margin.

## Remotion license

Remotion is free for individuals and companies of up to three people. Larger
teams need a [company license](https://www.remotion.pro/license).
