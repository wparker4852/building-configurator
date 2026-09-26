# Building Configurator

A 3D parametric designer with instant quoting for **tube-steel buildings** — carports, garages
and free-standing units. Customers design a building in the browser and see the price update as
they go; sales staff use the same engine with cost and margin exposed.

Comparable products: [Sensei3D](https://sensei3d.com/), [IdeaRoom](https://www.idearoom.com/).

### The domain, briefly

These are not post-frame or stick-built structures. A building is a row of **bents** — a pair of
legs and a bow of square tubing — set 4′ or 5′ **on center**, with panels screwed to the outside.
That has two consequences the model is built around:

- **Roof build is the first real choice**, and it is a separate axis from the silhouette:
  | Build | Eaves | Panels |
  |---|---|---|
  | Regular | rounded | run lengthwise |
  | A-Frame Boxed Eave | squared | run lengthwise |
  | A-Frame Vertical | squared | run ridge-to-eave over hat channel |
- **The frame is visible**, especially on an open carport, so it is modelled as real tubing
  rather than implied by a few posts.

---

## Running it

```bash
npm install
npm run dev        # http://localhost:5180
npm run build      # static bundle in dist/
npm run typecheck
```

There is no backend. Everything runs in the browser and `dist/` can be served from any static
host (Azure Static Web Apps, S3 + CloudFront, Netlify, a plain nginx).

---

## The two audiences, one build

Which app you get is decided entirely by the URL, so there is a single bundle to deploy:

| URL | What it is |
|---|---|
| `/` | Customer configurator — retail pricing, financing estimate, "Request my quote" |
| `/?mode=internal` | Internal configurator — adds cost, gross margin, per-line cost, a discount slider, internal-only add-ons |
| `/?mode=internal&view=admin` | Catalog & pricing admin, plus captured leads |
| `/?embed=1` | Chromeless, for the iframe widget |
| `/?model=standard-garage` | Opens on a specific model |
| `/#d=<token>` | Restores a saved design |
| `/demo.html` | A fake dealer marketing page showing the widget embedded |

`mode=internal` is **not a security boundary** — it only changes what the UI renders. Before
launch, put the internal routes behind real auth (see *What's next*).

---

## Embedding on a marketing site

```html
<div id="building-designer"></div>
<script src="https://YOUR-HOST/embed.js"
        data-target="#building-designer"
        data-model="standard-garage"
        data-height="780"
        async></script>
```

The widget renders in an iframe, so host-page CSS and JS can never collide with it.
`embed.js` forwards widget events to the host page as DOM events:

```js
window.addEventListener('building-designer:lead', (e) => {
  // e.detail = { quoteNo, modelId, total, shareLink, name, email, phone, zip }
  gtag('event', 'generate_lead', { value: e.detail.total });
});
```

Supported attributes: `data-target`, `data-model`, `data-height` (omit for responsive),
`data-design` (a `#d=` token), `data-mode`, `data-radius`, `data-title`.

---

## How it fits together

```
src/
  core/          pure domain logic — no React, no three.js
    types.ts       BuildingConfig, Catalog, Quote
    geometry.ts    config -> roof profile, wall outlines, roof planes, frame tubing, areas
    pricing.ts     (config, catalog, geometry) -> itemised Quote
    validate.ts    clamps a config to something buildable; surfaces warnings
    serialize.ts   config <-> URL hash
    catalog.ts     catalog loading + per-model starting configs
    leads.ts       lead capture (localStorage today, an API call tomorrow)
  data/
    catalog.json   every model, material, color, opening, add-on and pricing rule
  viewer/          three.js / react-three-fiber rendering
    materials.ts   panel textures painted on a canvas at runtime — no image assets
    Building.tsx   frame, walls, roof, doors, windows, trim, wainscot
    Scene.tsx      lighting, ground, camera presets, screenshot capture
  ui/              React screens
```

`core/` is deliberately free of React and three.js. The same geometry and pricing code can run
in Node for server-side quoting, PDF generation or a CAD/cut-list export without changes.

### Conventions worth knowing

- **Units are feet everywhere**, including three.js world units.
- `+X` is the building width (the gable-end span), `+Z` is the length (the direction the ridge
  runs), `+Y` is up. The building is centered on the origin.
- In wall-local space, **`+Z` always points out of the building**, on all four walls. That is
  what lets one set of door/window maths serve every side.
- Roof shape is one abstraction: `roofProfile()` returns the cross-section as points from the
  left eave to the right eave — gable is 3 points, single-slope 2. Walls, roof planes, frame
  bows and headroom checks all derive from it, so a new silhouette is one case in one function.
- A regular roof is that same profile run through `roundProfile()`. There are **two rounded
  forms**: the roof gets eaves *and* ridge rounded, the walls get only the ridge — because the
  panel curves down over the outside of the wall rather than cutting into it. Getting this
  wrong notches the endwall corners open.
- The frame is inset from the skin by one wall thickness on all sides, including the end bents,
  so tubing never pokes through a panel.

### Pricing

`priceBuilding()` returns an itemised `Quote`. Charges come from `catalog.json`:

- base $/sq ft × footprint, times the multipliers for enclosure, roof style, roof build,
  gauge, on-center spacing and certification
- adders for eave height above the model's base, and for pitch above its base
- siding × net wall area, roofing × roof area, premium-color upcharges per sq ft
- foundation × footprint, each door/window, each add-on against its own basis
- then discount (internal only) → freight → tax

Cost is derived per line from `rules.costFactors` (cost ÷ price by category), which is what
drives the internal margin readout. Openings on a wall that is not being built are neither
rendered nor charged.

---

## What's next

Roughly in the order it will matter:

1. **Auth + a real backend.** `mode=internal` is cosmetic. Leads and catalog edits live in
   `localStorage`, so they are per-browser and will be lost. `core/leads.ts` and
   `core/catalog.ts` are the only two files that touch storage — swap their bodies for API
   calls and nothing else changes.
2. **Freight by real distance.** `freightFor()` currently uses `rules.freight.defaultMiles`.
   Wire the customer's ZIP to a distance lookup from the plant.
3. **Lead delivery.** Today a lead is saved locally and the quote opens as a printable page.
   It should also email the customer and push to a CRM.
4. **Multi-tenant catalogs** if this is ever sold to dealers — the catalog is already one JSON
   document per brand, which is the right shape for it.
5. **Lean-tos — the biggest missing primitive.** A lean-to is a secondary roof and frame hung off
   one of the four sides, with its own width, length, height and pitch. It unlocks a whole
   product category at once, because the barn types are all centre-building-plus-lean-tos:
   *Standard Barn* (lean-tos under their own roofs), *Raised Center Barn* (centre section raised
   clear above them), *Straight Roof Barn* (one continuous roof over all three). Garage With
   Lean-to and Free Standing Lean-to fall out of the same primitive. Until it exists the Barns
   category is deliberately absent rather than faked with a wood-barn gambrel shape.
6. **Storage sections** (end / left / right), which is what makes a Utility Carport a distinct
   product rather than just a partly enclosed one.
7. **Frame-outs** as a distinct opening category, and a 2D elevation mode alongside the 3D view.
8. **A real cut list** off the frame members — the geometry already knows every tube's length.
9. **Tests.** `core/` is pure and is the part worth testing first — `roofProfile`,
   `buildGeometry` areas, and `priceBuilding` against known-good totals.

---

## Notes

- **React is pinned to `~19.2` on purpose.** `@react-three/fiber@9` declares
  `peer react ">=19 <19.3"`, so a floating `^19` resolves to 19.3+ and `npm install` fails.
- Textures are drawn on a `<canvas>` at runtime, so any hex color in the catalog works and the
  bundle carries no image assets.
- The 3D canvas uses `preserveDrawingBuffer` so the quote document can embed a render of the
  customer's actual design.
