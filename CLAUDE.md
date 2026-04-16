# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run backend + frontend together (recommended for development)
npm start

# Run separately
npm run backend     # Express server on port 3000
npm run frontend    # Parcel dev server on port 1234

# Tests (backend only)
npx jest
npx jest backend/tests/calculate-liquidity.test.js   # single test file
```

## Architecture

This is a cryptocurrency screening tool. The backend is an Express.js server that proxies Binance API data and computes technical indicators. The frontend is a vanilla JS app (ES modules, bundled by Parcel 1.x) that fetches from the backend and renders a filter/table/chart UI using jQuery and Apache ECharts.

### Backend (`backend/`)

The Express server (`server.js`) runs on port 3000. All API routes are under `/services`. Non-API requests are reverse-proxied to the Parcel dev server at `http://localhost:1234`.

- `backend/services/` — Express routers, one file per endpoint (e.g. `fetchRSI.js`, `fetchSMA.js`, `fetch24hsVolume.js`). Each exports a router mounted under `/services`.
- `backend/binance/` — Binance API wrappers (raw HTTP calls to `api.binance.com`). `get24HsVolume.js` fetches 24h ticker data, groups it into named volume buckets (`9M⇾`, `10M⇿30M`, `30M⇿50M`, etc.), and also saves snapshots to `backend/data/volume/`.
- `backend/technicals-indicators/` — Server-side indicator calculations using the `technicalindicators` npm package (Ichimoku Cloud, SMA). RSI is also computed here via `fetchRSI.js`.

### Frontend (`frontend/`)

Entry point: `frontend/index.html` → `frontend/script.js`.

`script.js` initialises all controllers in sequence:
1. `ShangaiChartController` — ECharts candlestick chart
2. `FavoriteController` — favorites sidebar
3. `FilterController` — volume/indicator filter tabs
4. `QuoteController` — quote selector (USDT / BTC / BNB)
5. `CurrencyController` — fetches all Binance currencies into `CurrencyModel.currencies`
6. `IndicatorController` — indicator search panel

**MVC pattern** in `frontend/`:
- `model/` — holds shared state (`CurrencyModel`, `FilterModel`, `IndicatorModel`, etc.)
- `view/` — renders DOM, fires and listens to jQuery custom events
- `controller/` — thin glue between model and view

**Central state object — `CurrencyModel`** (`model/currency-model.js`):
- `currencies` — `{ name, list: [{symbol, price, ...}] }` — all live Binance tickers
- `filters` — array of filter objects `{ name, list: [symbolStrings] }`. First entry is always the base Binance USDT filter. Volume filters are appended at init. Indicator filters are appended after a search.
- `joinFilters(selectedFilters)` — computes the intersection of two or more filter symbol lists and saves it as a new combined filter named `"filterA|filterB"`.

**Filter naming convention**: `"interval|type|params"`, e.g. `"1h|Binance|9M⇾"`, `"1h|r|a|7|b|9"` (RSI above 70 below 99 on 1h). The prefix before the first `|` drives color-coding in `FilterView` (1h=blue, 2h=cyan, 4h=teal, 1d=orange, etc.).

**Indicator search flow** (`view/indicator-view.js`):
1. User picks indicator type + parameters + intervals and clicks Search (`#btnSearch`).
2. `fetchCandlesAndIndicators(currencies, intervals)` is called — for each currency and each interval it hits the backend in parallel: `/services/candles`, `/services/ichimoku-cloud`, `/services/sma`, `/services/rsi`, `/services/fetch-lowest-index`, `/services/fetch-high-low-variation`.
3. The raw results are passed to a `create*Filter` utility (e.g. `createRsiFilter`, `createIchimokuFilter`, `createMovingAverageFilter` from `frontend/utils/`) which tests each item against the chosen condition and calls `CurrencyModel.addFilter()` with a new named filter.
4. A `filterViewOnSearchByIndicator` jQuery event is fired → `FilterView.render()` redraws the filter tab bar.

**Chart flow**: clicking a row's select button in `CurrencyView` fires the `selectCurrencyForChart` jQuery event with candlestick + Ichimoku data → `ShangaiChartController` / `ShangaiChartView` renders the ECharts chart.

### Key dependencies

- `technicalindicators` — RSI, SMA, Ichimoku Cloud calculations (used on both backend and frontend)
- `echarts` — candlestick charting (frontend)
- jQuery (`$`) — DOM manipulation and custom events (frontend)
- `parcel-bundler` v1 — frontend bundler (not Parcel 2)
- `binance-api-node` — Binance WebSocket/REST client (backend)
- `http-proxy` — proxies frontend requests through the backend server

### Tests

Jest tests are in `backend/tests/` and only cover backend logic. There are no frontend tests. Run with `npx jest`.
