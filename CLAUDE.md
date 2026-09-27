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
Doors and windows quote from the supplier component table (nearest stocked roll-up by area).

**Still on placeholder prices** (my invented numbers, not from any book): foundation (incl. the
new asphalt pad), anchors, add-ons (incl. J-trim, turbo vent), and the catalog fallback prices
for doors/windows. Premium wood/stone finishes are reported as unpriced, never estimated.

### Merged from the Walker Buildings configurator (partner's build)

The partner's single-file prototype is kept at `reference/walker-configurator-v4.html`. What was
taken from it, and where it lives now:

- **Frame engineering** (`FRAME_SPEC`, `buildFrame` in `core/geometry.ts`): 14 ga = 2½" tube,
  12 ga = 2¼" (`gauges[].tubeSize`); bent apex on squared bows; peak brace 2/4/6' under 25'
  wide, bottom chord + two struts from 25' (16/18/20' at 25–30', same rule extrapolated wider);
  45° knee braces 3'/4'; hat channel 1' from ridge then every 4'; eave rails on squared eaves;
  endwall studs ≤5' apart; frame-outs (full-height jambs, header, sill) at every opening; ladder legs = 7" gap + rungs 20" OC. **Which** leg style is the
  book's call (`Supplier.legStyleFor`), not the partner's height rule — his was 15'/16'.
  Improvements over his: legs, studs and base rails are cut around openings; the chord is set
  so its ends land on the bow (his poked through the roof at low pitch); knee braces stay on an
  end bent when that end is open.
- **AG panel profile** as a normal map (`walkProfile`/`ribNormalMap` in `viewer/materials.ts`),
  galvalume undersides, ridge cap bent to pitch, base trim, wood/stone prints, slab textures.
- **Inside (walk-in) view, orientation labels, architectural dimension lines, studio backdrop,
  head tracking** (`viewer/Scene.tsx`, `viewer/headTracking.ts` — MediaPipe loads from jsdelivr
  only when switched on).
- **2D floor plan** (`ui/FloorPlan.tsx`, `core/floorPlan.ts`): vehicles/equipment, fit judged
  against clear inside dims and the clearance under the truss, saved in the share link as
  `planItems`. The same items stand in 3D as generic low-poly shapes (`viewer/Equipment.tsx`),
  red when they do not fit; the walk-in camera stands at the first spot not occupied by one.
- **Leg upgrade is shaded darker** (`TubeMember.upgrade`, per-instance colour) and a double
  leg is drawn with a ½" reveal — touching tubes merged into one and the upgrade was invisible.
- **Clearances** in `Metrics`: `clearWidth/Length/Height`, `sideClearHeight`.
- **Colors** (premium wood/stone), roll-up 10×8 and 14×14, 30×36 window, tax by delivery state,
  single slope capped at 30' wide, and an **Add a part** form in admin (his "Dev Dashboard").

Not taken: his pricing (a `sqft × 9.5` placeholder), "Seneca style", the 12" boxed-eave and
professional-install toggles (no book prices them), and his lean-to/wing tabs (UI stubs only —
see lean-tos below).

Fixed along the way: `wallsPresent()` read the legacy `enclosure` field, so walls drawn and
walls charged could disagree (e.g. sides open + one end closed drew both sides). It now reads
`sidesClosed`/`endsClosed`, same as the book.

### Next, roughly in order

1. **Frameout pricing.** Doors/windows are wired; frameouts are not yet charged per opening.
   The books price a frameout *without* a door *higher* than one with ($250 vs $200), and door
   sizes differ between suppliers.
2. **Lean-tos.** The biggest missing geometry primitive. Unlocks the whole Barns category, which
   is centre-building-plus-lean-tos: Standard (separate roofs), Raised Center (centre lifted
   clear), Straight Roof (one continuous roof). Garage-with-lean-to and free-standing lean-to
   fall out of the same primitive. The Barns category is deliberately absent until this exists.
3. **Storage sections** (end / left / right) — what makes a Utility Carport a distinct product.
4. **Auth + a backend.** `mode=internal` is cosmetic, not a security boundary. Leads and catalog
   edits live in `localStorage`. `core/leads.ts` and `core/catalog.ts` are the only files that
   touch storage.
5. **Tests.** `core/` is pure and is the part worth testing — `roofProfile`, `buildGeometry`
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

## Branding

Walker Buildings, from walkerbuildings.com: yellow **#FFC301**, black, grey **#575757**, white (site
greys #727272 / #B0B0B0 / #D8D8D8 / #F4F4F4); Questrial body type, Poppins display. Logo files are in
`src/assets/brand/` via `src/ui/brand.ts`; the quote embeds them inline so a saved quote keeps them.
Text on the accent uses `--accent-ink` (black on yellow) and thin marks use `--accent-strong`, both
derived at runtime in `App.tsx` from `catalog.branding.accent` — never put white text on the yellow.

## Gotchas

- **React is pinned to `~19.2`.** `@react-three/fiber@9` declares `peer react ">=19 <19.3"`, so a
  floating `^19` resolves to 19.3+ and `npm install` fails with ERESOLVE.
- **The branch is `master`**, not `main`.
- Textures are drawn on a canvas at runtime — no image assets, any hex color works.
- The canvas uses `preserveDrawingBuffer` so the quote document can embed the actual render.
- Admin catalog edits persist to `localStorage` and silently override the shipped catalog. If
  pricing looks wrong, hit **Reset** in the admin header. Overrides from an older `version` are
  ignored, so bump `catalog.json`'s `version` whenever its shape changes (now 2).
- Canvas-painted textures parse hex by hand — `THREE.Color` converts to linear and paints
  everything too dark.
- Orientation labels draw over everything (`depthTest: false`) and fade by facing; drawn
  normally they hide under the eave from above and under the dimension lines from the front.
