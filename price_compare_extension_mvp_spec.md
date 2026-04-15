# Price Compare Chrome Extension — MVP Source Document

## 1. Project overview

**Working name:** PriceScout  
**Project type:** School project / Chrome extension  
**Goal:** Build a Chrome extension that detects the product a user is viewing on a shopping site and compares that product’s price with matching offers from other supported stores.

This document is the main source of truth for the MVP. It defines what the project does, what it does not do, how it is built, how two people divide the work, and what the expected deliverables are.

---

## 2. Problem statement

When users browse products online, they often do not know whether the current price is the best available. The extension should help by extracting product information from the current page and showing alternative offers from other stores.

---

## 3. MVP goal

The MVP must do these things reliably:

1. Work on **2–3 supported e-commerce websites**.
2. Detect a product page and extract basic product data.
3. Send the extracted data to a backend API.
4. Match the product against known offers from other stores.
5. Show the best matching offers in the popup.

The MVP does **not** need to support all stores, all product categories, or perfect matching.

---

## 4. Core user story

**As a shopper**, when I am on a product page, I want to click the extension and see whether the same product is available cheaper elsewhere.

### Success scenario

1. User opens a product page.
2. User clicks the extension icon.
3. Extension extracts title, price, URL, store, image, and optional identifiers.
4. Extension sends this data to the backend.
5. Backend finds matching offers.
6. Extension displays the best offers sorted by total price.

---

## 5. Scope

## In scope

- Chrome extension with popup UI
- Manifest V3
- Product extraction from DOM
- Backend API for comparison
- Small product/offer dataset
- Matching logic using SKU/model/title similarity
- Basic error handling
- Local development setup
- Demo-ready UI

## Out of scope for MVP

- Support for all websites
- User accounts
- Price history over time
- Push notifications
- Automatic background crawling of all stores
- ML-based product matching
- Mobile browser support
- Publishing to Chrome Web Store

---

## 6. Functional requirements

### FR-1: Open popup and run comparison
When the user clicks the extension icon on a supported product page, the popup should start comparison automatically.

### FR-2: Extract product information
The extension should extract, when possible:

- product title
- current page price
- page URL
- store/domain
- product image URL
- brand (optional)
- model (optional)
- SKU/MPN/EAN/GTIN (optional)

### FR-3: Send data to backend
The extension should send extracted product data as JSON to the backend `/compare` endpoint.

### FR-4: Match the product
The backend should return a list of matching offers from other stores.

### FR-5: Show results
The popup should show:

- current product title
- current store
- number of matches found
- cheapest offer
- list of matching offers
- link to each offer

### FR-6: Handle unsupported pages
If the page is not a product page or extraction fails, the extension should show a friendly error message.

### FR-7: Exclude current store from results
The backend or frontend should not show the same store as a comparison result unless explicitly needed for debugging.

---

## 7. Non-functional requirements

- Simple setup for school project demo
- Readable, modular code
- Small permission set in extension
- Fast enough to respond in about 1–3 seconds locally
- Easy for two people to work on separately
- Easy to explain in presentation/demo

---

## 8. Target users

- online shoppers
- students demonstrating browser extension functionality
- teachers evaluating software project structure

---

## 9. Supported store strategy

The MVP should support **2–3 known stores** only.

### Recommendation
Choose stores that:

- have product pages with stable HTML structure
- visibly show title and price in page source
- are easy to test repeatedly
- do not require login

### Important implementation rule
Use a **site adapter pattern**:

- each supported site has its own extractor function
- if no site-specific extractor works, use a generic fallback extractor

---

## 10. System architecture

## High-level flow

1. User clicks extension
2. Popup sends message to service worker
3. Service worker injects extractor into active tab
4. Extractor reads DOM and returns product info
5. Service worker sends product info to backend API
6. Backend matches product against offer dataset
7. Backend returns sorted matches
8. Popup displays results

## Components

### A. Chrome extension frontend
Responsible for:

- popup UI
- current tab access
- page extraction
- loading/error states
- result display
- local cache of last result

### B. Backend API
Responsible for:

- accepting product query data
- normalizing product fields
- finding matching offers
- sorting by price + shipping
- returning clean JSON response

### C. Data layer
Responsible for:

- storing canonical products
- storing store offers
- storing identifiers (SKU/EAN/MPN/model)

---

## 11. Technical stack

## Extension
- HTML
- CSS
- JavaScript
- Chrome Extension Manifest V3

## Backend
- Node.js
- Express
- CORS

## Data
- JSON file for simplest MVP
- optional SQLite if team wants better structure

## Tooling
- Git + GitHub
- VS Code
- Postman or Insomnia for API testing

---

## 12. Recommended project structure

```text
price-compare-project/
  extension/
    manifest.json
    src/
      background/
        service-worker.js
      popup/
        popup.html
        popup.css
        popup.js
      content/
        extractors.js
      shared/
        constants.js
        utils.js
  backend/
    package.json
    src/
      server.js
      matcher.js
      normalizer.js
      db.js
    data/
      offers.json
      products.json
    scripts/
      seed.js
  docs/
    MVP_SPEC.md
    API_CONTRACT.md
    DEMO_PLAN.md
```

---

## 13. Extension design

## 13.1 Manifest permissions
Keep permissions minimal.

Recommended permissions:

- `activeTab`
- `scripting`
- `storage`

Host permissions:

- backend API URL

Optional during development:

- localhost API URL

## 13.2 Popup responsibilities
The popup should:

- show loading state
- request comparison from service worker
- show error if extraction fails
- render comparison cards
- display savings information

## 13.3 Service worker responsibilities
The service worker should:

- listen for popup message
- query active tab
- inject extraction function or file
- call backend API
- cache result in `chrome.storage.local`
- return structured response to popup

## 13.4 Extractor responsibilities
The extractor should:

- detect current store/domain
- try site-specific extractor first
- fall back to generic selectors
- normalize extracted text
- return plain JSON object

---

## 14. Product extraction design

## 14.1 Fields to extract

Required fields:

- `title`
- `url`
- `store`

Recommended fields:

- `price`
- `currency`
- `image`
- `brand`
- `model`
- `sku`
- `ean`
- `mpn`

## 14.2 Example extraction object

```json
{
  "title": "Sony WH-1000XM5 Wireless Headphones",
  "price": 299.99,
  "currency": "EUR",
  "priceText": "299,99 €",
  "url": "https://example.com/product/123",
  "store": "example.com",
  "image": "https://example.com/image.jpg",
  "brand": "Sony",
  "model": "WH-1000XM5",
  "sku": "WH1000XM5B"
}
```

## 14.3 Generic extraction strategy

Try in this order:

1. JSON-LD product schema from `<script type="application/ld+json">`
2. meta tags like `og:title`, `og:image`
3. `[itemprop='price']`
4. common title selectors (`h1`, product title classes)
5. common price selectors (`.price`, `[data-price]`, price text patterns)

## 14.4 Site-specific adapters

Each supported site should have its own function, for example:

- `extractAmazonLike()`
- `extractStoreA()`
- `extractStoreB()`

The adapter should return `null` if it cannot confidently detect a product page.

---

## 15. Backend design

## 15.1 Endpoint

### `POST /compare`
Receives extracted product data and returns matching offers.

### Request example

```json
{
  "title": "Sony WH-1000XM5 Wireless Headphones",
  "price": 299.99,
  "currency": "EUR",
  "store": "example.com",
  "url": "https://example.com/product/123",
  "brand": "Sony",
  "model": "WH-1000XM5",
  "sku": "WH1000XM5B"
}
```

### Response example

```json
{
  "queryProduct": {
    "title": "Sony WH-1000XM5 Wireless Headphones",
    "store": "example.com",
    "price": 299.99,
    "currency": "EUR"
  },
  "matches": [
    {
      "store": "shop-a.com",
      "title": "Sony WH-1000XM5 Wireless Headphones",
      "price": 279.99,
      "shipping": 0,
      "total": 279.99,
      "currency": "EUR",
      "url": "https://shop-a.com/sony-wh1000xm5",
      "matchScore": 100,
      "matchReason": "SKU exact match"
    }
  ]
}
```

---

## 16. Data model

There are two possible MVP data models.

## Option A: Flat offers only
Fastest to build.

Each record stores:

- store
- title
- price
- shipping
- currency
- URL
- brand
- model
- sku
- ean
- mpn

## Option B: Canonical product + offers
Better structure.

### Product
- `productId`
- `brand`
- `model`
- `canonicalTitle`
- `sku`
- `ean`
- `mpn`

### Offer
- `offerId`
- `productId`
- `store`
- `title`
- `price`
- `shipping`
- `currency`
- `url`
- `lastUpdated`

### MVP recommendation
For a school project, start with **flat offers JSON**, then upgrade later if needed.

---

## 17. Matching logic

Matching should be simple, explainable, and deterministic.

## 17.1 Match priority

### Highest confidence
- exact SKU match
- exact EAN/UPC/GTIN match
- exact MPN match

### Medium confidence
- brand + model match

### Lower confidence
- title similarity / keyword overlap

## 17.2 Score example

- SKU exact match: `100`
- EAN exact match: `100`
- brand + model exact match: `90`
- normalized full title exact match: `85`
- high keyword overlap: `60–80`
- weak overlap: below threshold, ignore

## 17.3 Filtering rules

- exclude same store as query store
- exclude results below minimum score threshold
- optional: exclude different currencies in MVP if no conversion exists

## 17.4 Sorting rules

Sort by:

1. highest match score
2. lowest total cost (`price + shipping`)

---

## 18. Normalization rules

Before matching:

- lowercase all strings
- trim whitespace
- remove extra punctuation
- normalize hyphens and spaces in model names
- treat `WH1000XM5` and `WH-1000XM5` as similar if possible

### Example

`Sony WH1000XM5` and `Sony WH-1000XM5` should be considered very close.

---

## 19. Popup UI requirements

The popup should contain:

- extension name
- status text
- product title
- current price if available
- list of results
- cheapest badge / savings indicator
- error message area

## Suggested states

### Loading state
`Scanning current page...`

### Success state
`Found 3 matching offers`

### Empty state
`No matching offers found`

### Error state
`This page does not appear to be a supported product page`

---

## 20. Error handling rules

### Extraction errors
If title is missing or page is clearly not a product page:
- show unsupported page message

### API errors
If backend call fails:
- show backend unavailable message
- optionally show last cached result if available

### Parsing errors
If price is invalid:
- continue with title-only matching if possible

---

## 21. Caching

Use `chrome.storage.local` to store:

- last comparison result
- last product query
- optional user settings later

This is useful for:

- debugging
- faster popup reopen
- resilience when popup closes and reopens

---

## 22. Security and privacy notes

For MVP:

- do not collect personal user data
- do not require login
- only send product page data required for comparison
- keep permissions minimal
- do not inject remote scripts

What is sent to backend:

- product title
- page URL
- store/domain
- price and identifiers if found

What is not sent:

- browsing history beyond current active product page
- cookies
- account details

---

## 23. Development plan for two people

## Person A — Extension / frontend owner

Main responsibility: everything inside `extension/`

### Tasks
- create manifest
- build popup HTML/CSS/JS
- implement service worker message flow
- implement extractor structure
- render API results in popup
- show loading/error states
- save cached response

### Deliverables
- extension runs in Chrome developer mode
- popup starts comparison automatically
- extracted product object logged correctly
- results display correctly

## Person B — Backend / matching owner

Main responsibility: everything inside `backend/`

### Tasks
- create Express server
- implement `/compare`
- design data format
- create seed dataset
- implement normalization and scoring
- return sorted matches
- document API contract

### Deliverables
- backend runs locally
- `/compare` returns valid JSON
- matcher works for sample products
- data easy to update for demo

## Shared tasks
- choose supported stores
- define API contract
- test full flow together
- prepare demo and presentation
- write report/documentation

---

## 24. Task split by timeline

## Milestone 1 — Planning
Both together:
- choose supported stores
- define fields
- define JSON request/response
- agree on folder structure

## Milestone 2 — Independent setup
Person A:
- extension shell
- popup skeleton
- extraction prototype

Person B:
- API shell
- sample dataset
- dummy response route

## Milestone 3 — Integration
Both together:
- connect extension to backend
- verify request/response format
- fix mismatches

## Milestone 4 — Improve quality
Person A:
- better extractor selectors
- nicer popup UI
- more robust error handling

Person B:
- better matching logic
- stronger normalization
- better sample data

## Milestone 5 — Demo prep
Both together:
- final testing
- screenshots
- presentation slides
- demo scenarios

---

## 25. Suggested Git workflow

### Branches
- `main` → stable version
- `dev` → integration branch
- feature branches per task

### Example feature branches
- `feature/popup-ui`
- `feature/extractor`
- `feature/api`
- `feature/matcher`

### Team rules
- commit often
- write clear commit messages
- open pull requests before merging
- test before merge
- do small integrations often

---

## 26. API contract

## Request body

```json
{
  "title": "string",
  "price": 0,
  "currency": "string",
  "priceText": "string",
  "url": "string",
  "store": "string",
  "image": "string",
  "brand": "string",
  "model": "string",
  "sku": "string",
  "ean": "string",
  "mpn": "string"
}
```

## Response body

```json
{
  "queryProduct": {
    "title": "string",
    "store": "string",
    "price": 0,
    "currency": "string"
  },
  "matches": [
    {
      "store": "string",
      "title": "string",
      "price": 0,
      "shipping": 0,
      "total": 0,
      "currency": "string",
      "url": "string",
      "matchScore": 0,
      "matchReason": "string"
    }
  ]
}
```

---

## 27. Suggested coding standards

- use small functions
- avoid deeply nested logic
- use clear variable names
- keep all API responses consistent
- separate normalization from matching
- document important assumptions

### Naming examples
- `extractProductFromPage()`
- `normalizeTitle()`
- `scoreMatch()`
- `findMatches()`
- `renderResults()`

---

## 28. Testing plan

## Unit-style tests (manual or simple scripted)

### Extractor tests
Given a supported product page, verify:
- title extracted correctly
- price extracted correctly
- store/domain extracted correctly
- image extracted if available

### Matcher tests
Given a query with exact SKU:
- returns correct offer
- highest score assigned

Given similar titles but no SKU:
- returns reasonable matches

### API tests
Test `/compare` with:
- full valid request
- title-only request
- invalid/missing fields

### UI tests
Verify popup shows:
- loading state
- results state
- empty state
- error state

---

## 29. Demo plan

Prepare at least 3 demo pages:

1. product with exact match in dataset
2. product with partial title/model match
3. unsupported page or no match

During demo show:

- extension opens
- data extracted
- results loaded
- cheapest offer highlighted
- unsupported scenario handled properly

---

## 30. Possible future features

These are **not** required for MVP, but useful to mention in presentation:

- more supported stores
- side panel UI
- user preferences
- price history charts
- currency conversion
- notifications for price drops
- automated store crawling
- ML-based product similarity

---

## 31. Risks and mitigation

### Risk 1: Site HTML changes
**Mitigation:** support only 2–3 stores and use generic fallback.

### Risk 2: Product matching is inaccurate
**Mitigation:** use identifier-first matching and a small curated dataset.

### Risk 3: Extension cannot extract price from some pages
**Mitigation:** allow title-only matching and display partial result.

### Risk 4: Integration issues between frontend and backend
**Mitigation:** agree on JSON contract early and test with mock responses.

### Risk 5: Team merge conflicts
**Mitigation:** separate folders and use feature branches.

---

## 32. Definition of done for MVP

The MVP is complete when:

- extension loads successfully in Chrome developer mode
- popup can compare current supported product page
- extractor returns usable product info
- backend receives request and returns matches
- results are shown in popup in readable format
- unsupported pages show friendly error
- same-store results are excluded
- project can be demoed end-to-end

---

## 33. Recommended implementation order

1. Create backend with hardcoded dummy response
2. Create popup UI
3. Create service worker message flow
4. Extract title and URL only
5. Connect popup to backend
6. Add price extraction
7. Add store-specific adapters
8. Add matching logic
9. Improve UI and errors
10. Final demo/testing

---

## 34. Example pseudo-flow

```text
Popup opened
  -> send message COMPARE_CURRENT_TAB
    -> service worker gets active tab
      -> inject extractor into page
        -> extractor returns product object
      -> service worker POSTs to /compare
        -> backend normalizes query
        -> backend scores offers
        -> backend returns top matches
      -> service worker sends response to popup
  -> popup renders cards
```

---

## 35. Notes for report/presentation

When explaining the project, emphasize:

- real user problem solved
- browser extension architecture
- separation of concerns between extension and backend
- explainable matching algorithm
- limited MVP scope for reliability
- future expansion possibilities

---

## 36. Optional starter TODO list

### Person A TODO
- [ ] create manifest
- [ ] create popup HTML/CSS/JS
- [ ] add service worker message listener
- [ ] inject extractor into active tab
- [ ] parse title/price/store/image
- [ ] render response cards
- [ ] add loading/error/empty states

### Person B TODO
- [ ] create Express app
- [ ] add `/compare` route
- [ ] create `offers.json`
- [ ] create normalization helpers
- [ ] create `scoreMatch()`
- [ ] sort results by score and total price
- [ ] return response in agreed format

### Shared TODO
- [ ] select demo stores
- [ ] agree on API contract
- [ ] integrate frontend and backend
- [ ] test three demo scenarios
- [ ] prepare screenshots and slides

---

## 37. Final summary

This MVP is a **price comparison Chrome extension** that extracts product data from the current page and compares it against known offers from other stores using a simple backend API. The project is intentionally limited to a small number of supported stores and a clear matching algorithm so it remains feasible, understandable, and demoable for a school project.

This document should be treated as the baseline reference for implementation, division of work, testing, and presentation.

