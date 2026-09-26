# Building Configurator — working notes

3D parametric designer with instant quoting for **tube-steel buildings** (carports, garages,
free-standing units). Customer-facing configurator + internal quoting tool from one bundle.

This is a **standalone product for a side company** — no connection to Solutionz, no shared code
or branding. It only lives under `05. Code` because that is the local code root; the repo is
self-contained and can move anywhere.

`README.md` has the full architecture. This file is the short version plus current state.

---

## Run and verify

```bash
npm run dev        # http://localhost:5180  <- the dev server; nothing else serves the app
npm run typecheck
npm run build
npm run decode -- "<share link>"   # turn a #d= link back into a readable config
```

| URL | What |
|---|---|
| `/` | Customer configurator |
| `/?mode=internal` | Adds supplier cost, margin, discount |
| `/?mode=internal&view=admin` | Catalog, markup and lead admin |
| `/demo.html` | The embeddable widget on a mock dealer page |

To check 3D changes, drive a browser rather than trusting the code: `npm install --no-save
playwright && npx playwright install chromium`, then screenshot with
`--use-angle=swiftshader`. **Front / Side / Top and the "Frame only" toggle expose geometry bugs
that the 3D view hides** — several real bugs were only visible in those.

---

## Conventions that matter

- **Feet everywhere**, including three.js world units.
- `+X` = width (gable-end span), `+Z` = length (ridge direction), `+Y` = up, centered on origin.
- In wall-local space **`+Z` always points out of the building**, on all four walls. This is what
  lets one set of door/window maths serve every side.
- `roofProfile()` returns the roof cross-section left eave → right eave. Walls, roof planes,
  frame bows and headroom checks all derive from it.
- A regular roof runs that profile through `roundProfile()`. **Two rounded forms exist**: the roof
  gets eaves *and* ridge rounded; the walls get only the ridge, because the panel curves down
  over the *outside* of the wall. Getting this wrong notches the endwall corners open.
- The eave curl lives **outside** the footprint. Curling it inward drops the roof below the legs
  standing under it and they punch through.
- The frame is inset one panel thickness on all sides, **including the end bents**.

## Pricing model — read this before touching pricing

These buildings are priced from **printed matrices, not formulas**. `src/data/pricebooks/` holds
four transcribed books; `src/core/pricebook.ts` reads them; `src/core/suppliers.ts` wraps each as
a supplier.

- **Base price is roof only.** Sides are priced as a *pair*, each gable end *individually*.
- **The 4' and 5' OC books are one table indexed by bow count** (`bows = length / onCenter + 1`).
  All 80 overlapping cells agree exactly. 4' OC is not a multiplier — it buys more bows per foot.
- **Books are COST.** Markup per line category (`rules.markup`) produces the sell price.
- **Sizes are restricted to what each book prints.** Width/length/leg height are dropdowns.
  Anything the book cannot price is surfaced as "Not in the price book: …", never estimated.
- SBSI's frame is **1 ft shorter than the stated roof length** — its base table is keyed by roof
  length, its wall tables by frame length.

---

## Current state

Working and verified against the PDFs by hand: structure, walls and upgrades for all three
suppliers; geometry for all three roof builds; frame; openings with frame-outs; embed; quote doc.

**Still on placeholder prices** (my invented numbers, not from any book):
foundation, anchors, add-ons, and **doors/windows**. The books carry real figures for roll-up
doors, walk-in doors, windows, frameouts and insulation — they are already transcribed in the
JSON, just not wired up.

### Next, roughly in order

1. **Wire openings to supplier book prices.** The books disagree on door sizes between suppliers,
   so this needs a per-supplier opening list rather than one shared catalog. Note the books price
   a frameout *without* a door *higher* than one with ($250 vs $200).
2. **Draw the frame changes that are already being priced** — Double Leg + Double Baserail from
   14', ladder legs above that. Currently priced but not rendered.
3. **Lean-tos.** The biggest missing geometry primitive. Unlocks the whole Barns category, which
   is centre-building-plus-lean-tos: Standard (separate roofs), Raised Center (centre lifted
   clear), Straight Roof (one continuous roof). Garage-with-lean-to and free-standing lean-to
   fall out of the same primitive. The Barns category is deliberately absent until this exists.
4. **Storage sections** (end / left / right) — what makes a Utility Carport a distinct product.
5. **Auth + a backend.** `mode=internal` is cosmetic, not a security boundary. Leads and catalog
   edits live in `localStorage`. `core/leads.ts` and `core/catalog.ts` are the only files that
   touch storage.
6. **Tests.** `core/` is pure and is the part worth testing — `roofProfile`, `buildGeometry`
   areas, and the price-book lookups against known cells.

### Open with the vendors

Three SBSI cells look like typos. Most rows are generated by an exact formula (44' steps by
precisely $1,985, 52' by $2,550, 60' by $3,120), which makes these stand out:

| Cell | Printed | Pattern suggests |
|---|---|---|
| 38×51 | $18,500 | ~$19,900 — a +$800 step in a row running +$1,800–2,200 |
| 54×26 | $17,850 | ~$18,840 — makes 54' cheaper than 52', breaks its own +$2,690 row |
| 42' row | irregular | steps 1406/2430/1258/1342/3000/2282 between linear neighbours |

Also: the 4' OC book **reprints the 12–24 leg-height table on its 26–30 page** where the 5' OC
book uses higher figures. Currently using the wide-band (conservative) figures; see
`legHeightNote` in `pricebook.ts`. And SBSI's wall tables stop at 40' frame while its base table
runs to 50' — 45'/50' frames are unpriced and correctly reported as such.

Gaps the owner flagged on the price sheets, recorded as `gaps` in the JSON: 2' overhang, header
seal, roll-up door colors, standalone chain hoist, 1"/2" spray foam, half end / half dutch end,
more side-to-side connection widths.

---

## Gotchas

- **React is pinned to `~19.2`.** `@react-three/fiber@9` declares `peer react ">=19 <19.3"`, so a
  floating `^19` resolves to 19.3+ and `npm install` fails with ERESOLVE.
- **The branch is `master`**, not `main`.
- Textures are drawn on a canvas at runtime — no image assets, any hex color works.
- The canvas uses `preserveDrawingBuffer` so the quote document can embed the actual render.
- Admin catalog edits persist to `localStorage` and silently override the shipped catalog. If
  pricing looks wrong, hit **Reset** in the admin header.
