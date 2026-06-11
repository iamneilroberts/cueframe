# Examples

Three worked examples ship with the repo. Each was produced by the same pipeline: capture a
workflow, author callouts from plain-English instructions, then export `demo.html`,
`demo.mp4`, and `demo.gif`.

| Example | Command | Target | Output | What it shows |
| --- | --- | --- | --- | --- |
| `todo-app` (golden) | `npm run acceptance` | bundled sample app | `golden/` | The deterministic, CI-backed end-to-end run: capture, three callouts, three exports, all checks. |
| `saucedemo` | `npm run example:saucedemo` | live saucedemo.com | `saucedemo/` | A real third-party checkout flow. Callouts auto-anchor to the site's own `#id` / `data-test` elements. |
| `toolshop` | `npm run example:toolshop` | live practicesoftwaretesting.com | `toolshop/` | A browse-to-cart flow on an Angular store, anchored to the add-to-cart button, the checkout button, and the cart total. |

**Bundled vs live.** `todo-app` runs against the app bundled in this repo, so it reproduces
byte-for-byte and runs in CI. `saucedemo` and `toolshop` point at live third-party sites: the
committed artifacts are a snapshot, and re-running them needs network access and may need the
example's `cueframe.scenario.json` updated if the site changes its markup.

Every callout below was written as a plain-English instruction (a rough frame description plus
what to point at) and resolved by the `src/callout` engine. No JSON was hand-edited, and no
pixel rects were placed by hand.

---

## saucedemo: a checkout funnel

![SauceDemo checkout reel](saucedemo/demo.gif)

`npm run example:saucedemo` signs in to [saucedemo.com](https://www.saucedemo.com/) with the
public demo account, adds a product, and walks through checkout to the confirmation screen.
Seven golden frames:

| Frame | Caption |
| --- | --- |
| `f1` | The Swag Labs sign-in screen. |
| `f2` | The product catalog loads after sign-in. |
| `f3` | Added the Sauce Labs Backpack to the cart. |
| `f4` | Reviewing the cart before checkout. |
| `f5` | Entering shipping information at checkout. |
| `f6` | The order summary shows the items and the total. |
| `f7` | Order confirmed. Thank you for your order. |

Three callouts, each auto-anchored to one of the site's own elements:

| Callout | Frame | Anchor | What it points at |
| --- | --- | --- | --- |
| "Add to the cart without leaving the page" | `f2` | `#add-to-cart-sauce-labs-backpack` | The product's add-to-cart button |
| "Review the cart, then check out" | `f4` | `#checkout` | The checkout button |
| "Order confirmed in three steps" | `f7` | `#checkout_complete_container` | The confirmation panel |

The scenario is [`saucedemo/cueframe.scenario.json`](saucedemo/cueframe.scenario.json).

---

## toolshop: browse to cart

![Toolshop browse-to-cart reel](toolshop/demo.gif)

`npm run example:toolshop` opens [practicesoftwaretesting.com](https://practicesoftwaretesting.com/)
(an Angular store), opens a product, adds it to the cart, and lands on the cart. Four golden
frames:

| Frame | Caption |
| --- | --- |
| `f1` | The Toolshop catalog of tools. |
| `f2` | A product detail page with the price and Add to cart. |
| `f3` | The item is added to the cart. |
| `f4` | The shopping cart with the running total. |

Three callouts:

| Callout | Frame | Anchor | What it points at |
| --- | --- | --- | --- |
| "Add to the cart from the product page" | `f2` | `#btn-add-to-cart` | The add-to-cart button |
| "Proceed to checkout in one click" | `f4` | `[data-test="proceed-1"]` | The checkout button |
| "Your running total updates live" | `f4` | `[data-test="cart-total"]` | The cart total |

The product cards on this site use generated IDs, so the scenario targets the first product
with the prefix selector `[data-test^="product-"]` rather than a fixed ID. The scenario is
[`toolshop/cueframe.scenario.json`](toolshop/cueframe.scenario.json).

---

## golden: the bundled todo app

The `golden/` example captures the bundled todo SPA (`todo-app/`) and is the deterministic,
CI-backed run. It has its own annotated tour in
[`../docs/walkthrough.md`](../docs/walkthrough.md), which walks through all seven frames and
three callouts and how each of the three acts produced them.

---

## Use it on your own app

You do not need a bundled app. Point the CLI at any running URL and pass a scenario describing
the workflow. A scenario is a short list of steps; a step with a `caption` becomes a frame in
the reel.

`my-scenario.json`:

```json
{
  "name": "Sign up and land on the dashboard",
  "steps": [
    { "action": "waitFor", "selector": "#email" },
    { "action": "snapshot", "caption": "The sign-up form." },
    { "action": "fill", "selector": "#email", "value": "ada@example.com" },
    { "action": "fill", "selector": "#password", "value": "hunter2" },
    { "action": "click", "selector": "#submit", "label": "Sign up" },
    { "action": "waitFor", "selector": "[data-dashboard]" },
    { "action": "snapshot", "caption": "The dashboard loads with the welcome panel." }
  ]
}
```

```
npx cueframe capture http://localhost:3000 --scenario my-scenario.json --out demo/spec.json
npx cueframe validate demo/spec.json
npx cueframe export demo/spec.json --format gif --out demo/demo.gif
```

Use stable selectors (`#id`, `[data-*]`, ARIA roles) so the captured boxes are clean and
callouts can auto-anchor to them. The `saucedemo` and `toolshop` scenarios above are complete
real-world examples to copy from.
