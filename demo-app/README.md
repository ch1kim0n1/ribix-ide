# Checkout Demo — Ribix IDE QA Agent Showcase

This app ships with **intentional bugs** so ribix-ide can demonstrate its QA agent capabilities in a live demo. The Tester agent discovers each bug by interacting with the app exactly as a real user would — clicking, submitting forms, inspecting network responses — then classifies severity, writes a failing test, and generates a fix.

---

## Purpose

Ribix IDE's Tester agent uses Playwright to drive a real browser session against any running app. This demo gives it a small Express + React target with a realistic spread of P0–P3 bugs across the API and the UI so you can watch the full find-classify-fix loop in under 10 minutes.

---

## Setup

```bash
cd demo-app
npm install
npm start          # serves on http://localhost:3001
```

Then open `client/index.html` directly in a browser (or serve it statically) and point it at `http://localhost:3001`.

> Requires Node.js 16+. No database — state is in-memory.

---

## Known Bugs

### Server bugs (`server/index.js`)

| # | Severity | Route | Description |
|---|----------|-------|-------------|
| 1 | **P0** | `POST /api/checkout` | Crashes with `TypeError: Reduce of empty array with no initial value` when the cart is empty — `Array.reduce()` called with no initial accumulator argument |
| 2 | **P1** | `POST /api/login` | Auth bypass — any password is accepted for the `admin` username; the password field is read but never compared |
| 3 | **P2** | `GET /api/products` | No pagination — returns the full product list with no `limit`/`offset` support, creating an N+1 risk as the catalogue grows |
| 4 | **P3** | `POST /api/checkout` (error path) | Stack traces are included in the JSON error response body, leaking internal implementation details to clients |

### UI bugs (`client/index.html`)

| # | Severity | Location | Description |
|---|----------|----------|-------------|
| 5 | **P1** | Checkout form | Form inputs (username, password) are not saved to `sessionStorage` — back-navigation clears the form |
| 6 | **P1** | Checkout button | No loading/disabled state during the in-flight POST request — users can double-submit, creating duplicate orders |
| 7 | **P2** | Checkout button | No confirmation dialog before the irreversible `POST /api/checkout` — one misclick places an order |

---

## Running with Ribix IDE

1. Start the demo server: `cd demo-app && npm install && npm start`
2. Open Ribix IDE
3. In the **Command Center**, type:
   > Find and fix bugs in the checkout app at http://localhost:3001
4. Approve the agent plan
5. Watch the **Tester** agent navigate to the app, interact with each flow, and surface each bug with severity, reproduction steps, and a suggested fix

Expected: Ribix IDE finds and fixes all 4 server bugs and 3 UI bugs in under 10 minutes.

---

## File Structure

```
demo-app/
├── server/
│   └── index.js        # Express API with 4 intentional bugs
├── client/
│   └── index.html      # Self-contained UI with 3 intentional UI bugs
├── package.json
└── README.md
```
