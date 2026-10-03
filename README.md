# First-Trust

One of the app's features lets you select First Trust ETFs in the Watchlist and aggregate their holdings to see how often each ticker appears across the selected funds. Repeated holdings make overlapping exposure visible: the more selected funds include a ticker, the greater its potential influence on the portfolio; gains in that holding may help, while declines may hurt, and actual impact also depends on each fund's position size. Another feature makes it faster and easier to find funds with stronger growth over different periods, higher dividend yields or distributions, greater Total Return (price performance plus dividends), and other key performance metrics. A single-file client-side tool that reads the generated `./api/firsttrust` static feed (First Trust's official ftportfolios.com ETF list and per-fund pages - published NAV returns, expenses, yields, net assets, current holdings, full distribution history and the official daily NAV / market-price history export - plus SEC EDGAR N-PORT-P as a holdings fallback and Yahoo Finance as a market-price history fallback) into a searchable ETF/asset-class catalog with per-fund tabs, watchlist aggregation, ticker copy and CSV/TXT export - the same look, feel, columns and business logic as the sibling applications.

## Using Bun

```bash
bunx degit daggerok/First-Trust#main ./12345 && cd $_
bunx serve . -p 1234
open http://0:1234
```

The published application is available at <https://daggerok.github.io/First-Trust/>.

## Updating the static First Trust data

Run the updater with Bun:

```bash
bun install --frozen-lockfile
bun test
bun scripts/update-data.ts
```

Defaults for every control live in `scripts/update-data.config.json`. Precedence: file defaults < advanced JSON < nonblank inputs < protected Actions variable/env. Environment variables (with an optional `FIRSTTRUST_` prefix, for example `FIRSTTRUST_TICKERS`) override the file for local runs. Run `bun scripts/update-data.ts --help` to print every control with usage examples. All supplied filters use **AND** logic.

The **Update First Trust ETF data** GitHub Actions workflow exposes the most used controls as manual inputs plus an `advanced` input: a JSON object of other supported controls, for example `{"HOLDINGS_PAGE_SIZE":"500","HISTORY_PAGE_SIZE":"2000"}`. Blank inputs inherit the file value, and scheduled runs use the file defaults as-is. Unknown keys, non-scalar values and multiline values are rejected before any request. `SEC_UA` is not a manual input: the workflow reads it from the `SEC_UA` repository Actions variable and it wins over everything when nonblank. The workflow resolves controls with the same `resolveControls` function as the CLI and writes only `api/firsttrust`.

### Data sources

| Block | Source |
| --- | --- |
| Catalog (all listed First Trust ETFs) | The [official First Trust ETF list](https://www.ftportfolios.com/Retail/etf/etflist.aspx) (server-rendered page; its sections - Alternative, Income, Sector & Industry, Size/Style, Global/International, Thematic, Specialty, Target Outcome - become the category tabs), linked from the [First Trust ETF home page](https://www.ftportfolios.com/retail/etf/home.aspx). The list also supplies closing NAV, 30-day SEC yield and the 12-month trailing distribution rate; its [NAV performance view](https://www.ftportfolios.com/Retail/etf/etflist.aspx?DisplayType=PerformanceNav) adds the gross and net expense ratio and the month-end NAV returns of every fund in the same single request. |
| Fund details | `https://www.ftportfolios.com/Retail/Etf/EtfSummary.aspx?Ticker={TICKER}` (for example, [FDN](https://www.ftportfolios.com/Retail/Etf/EtfSummary.aspx?Ticker=FDN)): CUSIP, ISIN, exchange, inception, gross and net expense ratio, closing NAV and market price, bid/ask premium, total net assets, SEC yield, distribution rates and month-end / quarter-end NAV performance. |
| Holdings per fund | `https://www.ftportfolios.com/Retail/Etf/EtfHoldings.aspx?Ticker={TICKER}` - the full published holdings table (equities, bonds, FLEX options and cash). |
| Distributions | `https://www.ftportfolios.com/Retail/Etf/EtfDividHistory.aspx?Ticker={TICKER}` - every year listed by the page (ex, record and payable dates, amount and type). Later runs refresh the newest published years and keep older rows. |
| Daily history | The official "Export Prices to Excel" download on `https://www.ftportfolios.com/Retail/Etf/EtfPriceHistory.aspx?Ticker={TICKER}` - daily NAV, market price and net assets since inception, read by a zero-dependency XLSX reader. Premium/discount is computed from that day's market price and NAV. The [Yahoo Finance chart API](https://query1.finance.yahoo.com/v8/finance/chart/{TICKER}) is used only if the export fails (market price only; the NAV column stays blank). |
| Holdings fallback | SEC EDGAR Form N-PORT-P for the First Trust ETF trusts (for example First Trust Exchange-Traded Fund, CIK `0001329377`; First Trust Exchange-Traded AlphaDEX Fund, CIK `0001383496`), resolved per ticker from SEC's fund ticker table, only when ftportfolios.com provides no holdings. SEC requests declare the `SEC_UA` contact. An N-PORT snapshot may be less current than the issuer's daily holdings. |

### Metrics and caveats

The updater uses issuer-published NAV performance values for month-end and quarter-end. The catalog's cumulative 3-, 5- and 10-year Total Return columns are derived from the corresponding published annualized NAV returns using `(1 + annualized return)^years - 1`; 1-year and YTD use the published period return. Missing tenors stay unavailable. Dividend Yield is First Trust's published 12-month distribution rate; payment frequency is inferred from the ordinary distributions of the latest year (funds without a distribution in the last ~13 months show `00 - None`).

- `metrics.returnsBasis` is always a non-empty label of how returns are computed: official First Trust NAV total returns from the month-end performance table, with cumulative 3-, 5- and 10-year values derived from the published annualized ones
- `metrics.performanceAsOf` is the ISO date (`YYYY-MM-DD`) of that performance table, not the NAV date; it is `null` only for funds without a published performance table yet (for example newly launched funds)
- Net assets, expense ratios, SEC yield, distribution rates and NAV returns are issuer-published values; NAV and market price come from the official daily export
- Yahoo Finance history (used only if the official export fails) carries market price only, so it is an estimate and the NAV and premium/discount columns stay blank
- SEC N-PORT-P holdings are a periodic snapshot and may be less current than the issuer's daily holdings
- Each fund stores an as-of date and a source label for its holdings and history
- Unavailable values are shown as unavailable, never as `0`
- Unselected funds keep their previously published entries and data files, and a limited ticker run preserves the full catalog
- `metrics` always carries the same keys (`ytd`, `tr1y`, `tr3y`, `tr5y`, `tr10y`, `cagr3y`, `cagr5y`, `cagr10y`, `siAnn`, `dividendYield`, `dividendYieldText`, `secYield`, `secYieldText`, `returnsBasis`, `performanceAsOf`)
- A fund that is in the catalog but has no `funds/<TICKER>/meta.json` yet is listed with `dataFile: null` and all-null metrics; every fund that has a `meta.json` stays listed
- Every fund is either fully updated or fully kept: when its summary page, holdings, history or distributions cannot be read in a run, nothing is written for it and its previous published state stays untouched (a first publication of a new fund writes what is available)
- An SEC N-PORT-P fallback never replaces holdings that are newer than the filing
- Files are written through a temp file and a rename; a fund's pages are written first, then `meta.json`, and stale pages are removed afterwards; an identical rerun produces no diff (timestamps move only when content moved)
- Every request has a 45 s timeout (headers and body) and is retried per `MAX_RETRIES`; the run stops taking new funds after 25 minutes, still writes the index, and the next run continues after the last processed fund
- New funds in the catalog are printed as `NEW FUNDS: A, B` and added to the GitHub step summary; the run exits non-zero when every fund failed

### Update controls

Every row below has a matching key in `scripts/update-data.config.json` (all values are strings; the table shows the checked-in default). The same names are accepted in `advanced`, and the common ones are individual workflow inputs (lowercase names)

| Control | Default | Meaning |
| --- | --: | --- |
| `MAX_FETCHES` | `0` (all) | Funds per batch. With a positive value, processing resumes after the saved ticker cursor and wraps around; `0` processes all eligible funds. Only funds that pass the filters count. A `TICKERS` run never reads or changes the cursor. |
| `REQUEST_SLEEP` | `1` | Minimum delay in seconds between request starts per worker lane (each fund needs about six requests). |
| `CONCURRENCY` | `2` | Number of parallel fund workers. |
| `MAX_RETRIES` | `2` | Retries after the initial request (integer >= 1). Network errors and HTTP 403/408/425/429/5xx responses are retried with bounded exponential backoff. |
| `HOLDINGS_PAGE_SIZE` | `250` | Rows in each generated current-holdings JSON page (`advanced` only). |
| `HISTORY_PAGE_SIZE` | `1000` | Rows in each generated daily-history JSON page (`advanced` only). |
| `HISTORY_RANGE` | `max` | History window for the official export and the Yahoo fallback: `max` or a whole number of years such as `10y`, `5y` or `1y`. The Yahoo request carries explicit `period1`/`period2`. Any other value (for example `6mo`) is an error, never a silent `max`. |
| `TICKERS` | empty (all) | Space-, comma- or semicolon-separated ticker allowlist, e.g. `FDN FTSM FJAN`. |
| `AUM` | `:` | Net Assets range. Each bound may be a USD amount or `K`/`M`/`B`/`T`, or one of `nano`, `micro`, `small`, `mid`, `large`. |
| `TER` | `:` | Gross expense-ratio range in percent (`min:max`). |
| `DIVIDEND_YIELD` | `:` | Published 12-month distribution-rate range in percent. |
| `SEC_YIELD` | `:` | Published 30-day SEC yield range in percent. |
| `PERFORMANCE_YTD`, `PERFORMANCE_1Y`, `PERFORMANCE_3Y`, `PERFORMANCE_5Y`, `PERFORMANCE_10Y` | `:` | Published NAV return ranges in percent; multi-year performance filters use First Trust's annualized values. |
| `TOTAL_RETURN_YTD`, `TOTAL_RETURN_1Y`, `TOTAL_RETURN_3Y`, `TOTAL_RETURN_5Y`, `TOTAL_RETURN_10Y` | `:` | Total Return ranges in percent; multi-year values are derived from First Trust annualized NAV returns as described above. |
| `EDGAR_FALLBACK` | `true` | Use SEC N-PORT-P holdings when official First Trust holdings are unavailable. |
| `SEC_UA` | `daggerok ETF feed daggerok@gmail.com` | SEC User-Agent with a contact; redacted in config logs. The `SEC_UA` repository Actions variable (or env) overrides it. |
| `SKIP_YAHOO` | `false` | Do not call Yahoo when the official history export fails; a fund with a published state and no history this run is then kept entirely as it was. |
| `VERBOSE` | `false` | Show per-request retries and fallback details. |
| `USE_SYSTEM_CA` | `auto` | TLS trust store: `auto` restarts the updater once with Bun's `--use-system-ca` when a request fails with an untrusted-certificate error; `true` always uses the system CA store; `false` never restarts. Not an individual workflow input: use `advanced`, the config file or the CLI environment. |

`TICKERS` combines with AUM, TER, yield and return filters using AND logic. TER, yield and return filters use the freshly downloaded ETF list values (previously published values fill any gap); an AUM filter reads each candidate's fund summary page first

### Examples

```bash
MAX_FETCHES=10 bun scripts/update-data.ts
TICKERS="FDN FTSM FJAN" bun scripts/update-data.ts
AUM="1B:" TER=":0.5" bun scripts/update-data.ts
PERFORMANCE_1Y="15:" bun scripts/update-data.ts
```

## TypeScript and verification

The browser app is intentionally build-free: `index.html` carries the markup, styles and bootstrap, and `app.tsx` is TypeScript compiled in the browser with Babel standalone - no build step, no bundler, no `tsconfig.json` needed. Bun runs TypeScript out of the box.

Verification before every publish:

```bash
bun install --frozen-lockfile
bun test
bun build --target=bun scripts/update-data.ts --outfile=/dev/null
git diff --check
```

`bun test` also covers the README controls table, the config file and the workflow.

## Brands table

| Brand | Where to get the data |
| --- | --- |
| **AAM** | [aamlive.com](https://www.aamlive.com/ETF) \| [AAM](https://daggerok.github.io/AAM/) |
| **abrdn (Aberdeen)** | [aberdeeninvestments.com](https://www.aberdeeninvestments.com/en-us/investor/funds/etfs) \| [aberdeen](https://daggerok.github.io/aberdeen/) |
| **Amplify** | [amplifyetfs.com](https://amplifyetfs.com/) \| [Amplify](https://daggerok.github.io/Amplify/) |
| **ARK Invest** | [ark-funds.com](https://www.ark-funds.com/our-etfs/) \| [ARK](https://daggerok.github.io/ARK/) |
| **Capital Group** | [capitalgroup.com](https://www.capitalgroup.com/advisor/investments/exchange-traded-funds.html) \| [Capital-Group](https://daggerok.github.io/Capital-Group/) |
| **Fidelity** | [fidelity.com](https://www.fidelity.com/etfs) \| [Fidelity](https://daggerok.github.io/Fidelity/) |
| **First Trust** | [ftportfolios.com](https://www.ftportfolios.com/Retail/etf/etflist.aspx) \| [First-Trust](https://daggerok.github.io/First-Trust/) |
| **Franklin Templeton** | [franklintempleton.com](https://www.franklintempleton.com/investments/options/exchange-traded-funds) \| [Franklin](https://daggerok.github.io/Franklin/) |
| **Global X** | [globalxetfs.com/explore](https://www.globalxetfs.com/explore) \| [Global-X](https://daggerok.github.io/Global-X/) |
| **Goldman Sachs** | [am.gs.com](https://am.gs.com/en-us/individual/funds?locale=en-us&audience=individual&sf=funds&filters=funds%7CETF&limit=100) \| [Goldman-Sachs](https://daggerok.github.io/Goldman-Sachs/) |
| **Invesco** | [invesco.com](https://www.invesco.com/us/en/financial-products/etfs.html) \| [Invesco](https://daggerok.github.io/Invesco/) |
| **iShares** | [ishares.com](https://www.ishares.com/) \| [iShares](https://daggerok.github.io/iShares/) |
| **JPMorgan** | [am.jpmorgan.com](https://am.jpmorgan.com/us/en/asset-management/adv/products/fund-explorer/etf) \| [JPMorgan](https://daggerok.github.io/JPMorgan/) |
| **NEOS** | [neosfunds.com](https://neosfunds.com/#explore-etfs) \| [Neos](https://daggerok.github.io/Neos/) |
| **Northern Trust** | [etfs.ntam.northerntrust.com](https://etfs.ntam.northerntrust.com/us/en/individual/funds) \| [Northern-Trust](https://daggerok.github.io/Northern-Trust/) |
| **Pacer ETFs** | [paceretfs.com](https://www.paceretfs.com/products/) \| [Pacer](https://daggerok.github.io/Pacer/) |
| **Parametric** | [eatonvance.com](https://www.eatonvance.com/products/etfs.html) \| [Parametric](https://daggerok.github.io/Parametric/) |
| **ProShares** | [proshares.com](https://www.proshares.com/our-etfs/find-proshares-etfs) \| [ProShares](https://daggerok.github.io/ProShares/) |
| **Schwab** | [schwabassetmanagement.com](https://www.schwabassetmanagement.com/products) \| [Schwab](https://daggerok.github.io/Schwab/) |
| **SP Funds** | [sp-funds.com](https://www.sp-funds.com/) \| [SP-Funds](https://daggerok.github.io/SP-Funds/) |
| **SPDR** | [ssga.com](https://www.ssga.com/us/en/intermediary/etfs/fund-finder) \| [SPDR](https://daggerok.github.io/SPDR/) |
| **Sprott ETFs** | [sprottetfs.com](https://sprottetfs.com/) \| [Sprott](https://daggerok.github.io/Sprott/) |
| **Tema ETFs** | [temaetfs.com](https://temaetfs.com/funds) \| [Tema](https://daggerok.github.io/Tema/) |
| **Themes ETFs** | [themesetfs.com/etfs](https://themesetfs.com/etfs) \| [Themes](https://daggerok.github.io/Themes/) |
| **VanEck** | [vaneck.com](https://www.vaneck.com/us/en/etf-mutual-fund-finder/) \| [VanEck](https://daggerok.github.io/VanEck/) |
| **Vanguard** | [investor.vanguard.com](https://investor.vanguard.com/etf/list) \| [Vanguard](https://daggerok.github.io/Vanguard/) |
| **VictoryShares** | [vcm.com VictoryShares ETFs](https://www.vcm.com/products/victoryshares-etfs/victoryshares-etfs-list) \| [VictoryShares](https://daggerok.github.io/VictoryShares/) |
| **WisdomTree** | [wisdomtree.com](https://www.wisdomtree.com/investments) \| [WisdomTree](https://daggerok.github.io/WisdomTree/) |
| **Xtrackers** | [etf.dws.com](https://etf.dws.com/en-us/etf-products/) \| [Xtrackers](https://daggerok.github.io/Xtrackers/) |

## Sibling applications

| Application | Data provider | Repository |
| --- | --- | --- |
| AAM | Official AAM catalog/detail HTML + full holdings XLS + SEC N-PORT holdings fallback + Yahoo market history/dividends | [AAM](https://github.com/daggerok/AAM) |
| abrdn (Aberdeen) | Official Aberdeen gateway + SEC N-PORT holdings fallback + Yahoo history/dividends | [aberdeen](https://github.com/daggerok/aberdeen) |
| Amplify | Amplify ETFs Firestore data feed + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history/dividends | [Amplify](https://github.com/daggerok/Amplify) |
| ARK Invest | ark-funds.com fund pages + overview/NAV-history/performance JSON + official daily holdings CSV + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance distributions/history fallback | [ARK](https://github.com/daggerok/ARK) |
| Capital Group | Official Capital Group fund data + SEC N-PORT holdings fallback + Yahoo history fallback | [Capital-Group](https://github.com/daggerok/Capital-Group) |
| Fidelity | SEC EDGAR N-PORT-P + Yahoo Finance | [Fidelity](https://github.com/daggerok/Fidelity) |
| First Trust | ftportfolios.com official ETF list + fund summary, holdings, distribution and price-history export pages + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history fallback | [First-Trust](https://github.com/daggerok/First-Trust) |
| Franklin Templeton | franklintempleton.com ETF listings + product pages + SEC EDGAR N-PORT-P | [Franklin](https://github.com/daggerok/Franklin) |
| Global X | globalxetfs.com Next.js catalog and fund pages + dated full-holdings CSV | [Global-X](https://github.com/daggerok/Global-X) |
| Goldman Sachs | am.gs.com fund finder + detail pages + SEC EDGAR N-PORT-P | [Goldman-Sachs](https://github.com/daggerok/Goldman-Sachs) |
| Invesco | invesco.com fund pages and sitemap + official Invesco fund API (monthly returns, NAV, AUM, yields, daily holdings, expense ratio) + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history/dividends | [Invesco](https://github.com/daggerok/Invesco) |
| iShares | iShares (BlackRock) product workbooks | [iShares](https://github.com/daggerok/iShares) |
| JPMorgan | am.jpmorgan.com fund explorer + product-data JSON | [JPMorgan](https://github.com/daggerok/JPMorgan) |
| NEOS | neosfunds.com lineup table + official fund pages + daily holdings CSV | [Neos](https://github.com/daggerok/Neos) |
| Northern Trust | etfs.ntam.northerntrust.com funds list + per-fund CSV/JSON downloads | [Northern-Trust](https://github.com/daggerok/Northern-Trust) |
| Pacer ETFs | paceretfs.com product catalog and fund pages (Cloudflare WAF; r.jina.ai proxy fallback) + SEC EDGAR N-PORT-P (Pacer Funds Trust) + Yahoo Finance history/dividends | [Pacer](https://github.com/daggerok/Pacer) |
| Parametric | eatonvance.com ETF catalog and Parametric product pages + SEC EDGAR N-PORT-P holdings + Yahoo Finance history/dividends | [Parametric](https://github.com/daggerok/Parametric) |
| ProShares | proshares.com ETF finder + fund pages + official data host | [ProShares](https://github.com/daggerok/ProShares) |
| Schwab | schwabassetmanagement.com product pages + CSV exports | [Schwab](https://github.com/daggerok/Schwab) |
| SP Funds | sp-funds.com homepage catalog, fund pages and daily holdings CSV + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history/dividends | [SP-Funds](https://github.com/daggerok/SP-Funds) |
| SPDR | SSGA / State Street public feeds | [SPDR](https://github.com/daggerok/SPDR) |
| Sprott ETFs | sprottetfs.com fund pages + SEC EDGAR N-PORT-P (Sprott Funds Trust) + Yahoo Finance history/dividends | [Sprott](https://github.com/daggerok/Sprott) |
| Tema ETFs | Tema official fund pages + dated daily holdings CSV; SEC EDGAR N-PORT-P holdings fallback only + Yahoo Finance price/history/dividend fallback | [Tema](https://github.com/daggerok/Tema) |
| Themes ETFs | themesetfs.com catalog + daily holdings CSV + Yahoo Finance history/dividends + SEC N-PORT-P holdings fallback | [Themes](https://github.com/daggerok/Themes) |
| VanEck | vaneck.com ETF finder + product pages | [VanEck](https://github.com/daggerok/VanEck) |
| Vanguard | Vanguard product pages + SEC EDGAR N-PORT-P | [Vanguard](https://github.com/daggerok/Vanguard) |
| VictoryShares | VCM VictoryShares catalog and product JSON + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance adjusted-market-price history | [VictoryShares](https://github.com/daggerok/VictoryShares) |
| WisdomTree | WisdomTree product table + SEC EDGAR N-PORT-P + Yahoo Finance | [WisdomTree](https://github.com/daggerok/WisdomTree) |
| Xtrackers | Official DWS catalog/US sitemap + PDP/XLSX + SEC N-PORT-P holdings fallback + Yahoo Finance daily prices/history/dividends | [Xtrackers](https://github.com/daggerok/Xtrackers) |

## License

[MIT - same as all sibling ETF repositories.](./LICENSE)

First Trust, First Trust Portfolios L.P., First Trust Advisors L.P. and the fund names/tickers referenced here are trademarks of their respective owners. This is an independent, unofficial tool; it is not affiliated with, endorsed by, or sponsored by First Trust Portfolios L.P. or First Trust Advisors L.P. All data is reproduced from First Trust's public ftportfolios.com fund pages, public SEC EDGAR filings and Yahoo Finance for research purposes. All other trademarks, including index names, are the property of their respective owners.
