# First-Trust

One of the app's features lets you select First Trust ETFs in the Watchlist and aggregate their holdings to see how often each ticker appears across the selected funds. Repeated holdings make overlapping exposure visible: the more selected funds include a ticker, the greater its potential influence on the portfolio; gains in that holding may help, while declines may hurt, and actual impact also depends on each fund's position size. Another feature makes it faster and easier to find funds with stronger growth over different periods, higher dividend yields or distributions, greater Total Return (price performance plus dividends), and other key performance metrics. A single-file client-side tool that reads the generated `./api/firsttrust` static feed (First Trust's official ftportfolios.com ETF list and per-fund pages — published NAV returns, expenses, yields, net assets, current holdings, full distribution history and the official daily NAV / market-price history export — plus SEC EDGAR N-PORT-P as a holdings fallback and Yahoo Finance as a market-price history fallback) into a searchable ETF/asset-class catalog with per-fund tabs, watchlist aggregation, ticker copy and CSV/TXT export — the same look, feel, columns and business logic as the sibling applications.

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
bun test scripts/update-data.test.ts
bun scripts/update-data.ts
```

Run `bun scripts/update-data.ts --help` to print every configuration variable with its usage examples. The **Update First Trust ETF data** GitHub Actions workflow exposes the same settings as manual inputs, except `SEC_UA`, which it reads from the `SEC_UA` repository variable (GitHub allows at most 25 manual inputs, and a variable also reaches the weekly scheduled run). All supplied filters use **AND** logic.

### Data sources

| Block | Source |
| --- | --- |
| Catalog (all listed First Trust ETFs) | The [official First Trust ETF list](https://www.ftportfolios.com/Retail/etf/etflist.aspx) (server-rendered page; its sections — Alternative, Income, Sector & Industry, Size/Style, Global/International, Thematic, Specialty, Target Outcome — become the category tabs), linked from the [First Trust ETF home page](https://www.ftportfolios.com/retail/etf/home.aspx). The list also supplies closing NAV, 30-day SEC yield and the 12-month trailing distribution rate; its [NAV performance view](https://www.ftportfolios.com/Retail/etf/etflist.aspx?DisplayType=PerformanceNav) adds the gross and net expense ratio and the month-end NAV returns of every fund in the same single request. |
| Fund details | `https://www.ftportfolios.com/Retail/Etf/EtfSummary.aspx?Ticker={TICKER}` (for example, [FDN](https://www.ftportfolios.com/Retail/Etf/EtfSummary.aspx?Ticker=FDN)): CUSIP, ISIN, exchange, inception, gross and net expense ratio, closing NAV and market price, bid/ask premium, total net assets, SEC yield, distribution rates and month-end / quarter-end NAV performance. |
| Holdings per fund | `https://www.ftportfolios.com/Retail/Etf/EtfHoldings.aspx?Ticker={TICKER}` — the full published holdings table (equities, bonds, FLEX options and cash). |
| Distributions | `https://www.ftportfolios.com/Retail/Etf/EtfDividHistory.aspx?Ticker={TICKER}` — every year listed by the page (ex, record and payable dates, amount and type). Later runs refresh the newest published years and keep older rows. |
| Daily history | The official "Export Prices to Excel" download on `https://www.ftportfolios.com/Retail/Etf/EtfPriceHistory.aspx?Ticker={TICKER}` — daily NAV, market price and net assets since inception, read by a zero-dependency XLSX reader. Premium/discount is computed from that day's market price and NAV. The [Yahoo Finance chart API](https://query1.finance.yahoo.com/v8/finance/chart/{TICKER}) is used only if the export fails (market price only; the NAV column stays blank). |
| Holdings fallback | SEC EDGAR Form N-PORT-P for the First Trust ETF trusts (for example First Trust Exchange-Traded Fund, CIK `0001329377`; First Trust Exchange-Traded AlphaDEX Fund, CIK `0001383496`), resolved per ticker from SEC's fund ticker table, only when ftportfolios.com provides no holdings. Configure `SEC_UA` with an organizational contact before using SEC requests. An N-PORT snapshot may be less current than the issuer's daily holdings. |

The updater uses issuer-published NAV performance values for month-end and quarter-end. The catalog's cumulative 3-, 5- and 10-year Total Return columns are derived from the corresponding published annualized NAV returns using `(1 + annualized return)^years - 1`; 1-year and YTD use the published period return. Missing tenors stay unavailable. Dividend Yield is First Trust's published 12-month distribution rate; payment frequency is inferred from the ordinary distributions of the latest year (funds without a distribution in the last ~13 months show `00 - None`).

### Update controls

| Environment variable | Default | Meaning |
| --- | --: | --- |
| `MAX_FETCHES` | `0` (all) | Funds per batch. With a positive value, processing resumes after the saved ticker cursor; `0` processes all eligible funds. |
| `REQUEST_SLEEP` | `1` | Minimum delay in seconds between request starts per worker lane (each fund needs about six requests). |
| `CONCURRENCY` | `2` | Number of parallel fund workers. |
| `AUM` | `:` | Net Assets range. Each bound may be a USD amount or `K`/`M`/`B`/`T`, or one of `nano`, `micro`, `small`, `mid`, `large`. |
| `TER` | `:` | Gross expense-ratio range in percent (`min:max`). |
| `DIVIDEND_YIELD` | `:` | Published 12-month distribution-rate range in percent. |
| `SEC_YIELD` | `:` | Published 30-day SEC yield range in percent. |
| `PERFORMANCE_YTD`, `PERFORMANCE_1Y`, `PERFORMANCE_3Y`, `PERFORMANCE_5Y`, `PERFORMANCE_10Y` | `:` | Published NAV return ranges in percent; multi-year performance filters use First Trust's annualized values. |
| `TOTAL_RETURN_YTD`, `TOTAL_RETURN_1Y`, `TOTAL_RETURN_3Y`, `TOTAL_RETURN_5Y`, `TOTAL_RETURN_10Y` | `:` | Total Return ranges in percent; multi-year values are derived from First Trust annualized NAV returns as described above. |
| `TICKERS` | all | Space-, comma- or semicolon-separated ticker allowlist, e.g. `FDN FTSM FJAN`. |
| `HOLDINGS_PAGE_SIZE` | `250` | Rows in each generated current-holdings JSON page. |
| `HISTORY_PAGE_SIZE` | `1000` | Rows in each generated daily-history JSON page. |
| `HISTORY_RANGE` | `max` | History window for the official export (and the Yahoo fallback): `max` or a whole number of years or months such as `10y`, `5y`, `1y` or `6mo`. |
| `MAX_RETRIES` | `2` | Retries after the initial request. Network errors and HTTP 403/408/425/429/5xx responses are retried with bounded exponential backoff. |
| `EDGAR_FALLBACK` | on | Use SEC N-PORT-P holdings when official First Trust holdings are unavailable. |
| `SEC_UA` | not configured | SEC User-Agent with a valid organizational contact. Required only if the EDGAR fallback is used. In GitHub Actions, set it as the `SEC_UA` repository variable. |
| `SKIP_YAHOO` | off | Do not call Yahoo when the official history export fails; retain existing history when available. |
| `VERBOSE` | off | Show per-request retries and fallback details. |

`TICKERS` combines with AUM, TER, yield and return filters using AND logic. TER, yield and return filters use the freshly downloaded ETF list values (previously published values fill any gap); an AUM filter reads each candidate's fund summary page first. Every variable also accepts a `FIRSTTRUST_` prefix (for example `FIRSTTRUST_TICKERS`). Unselected funds retain their previously published entries and data files. The updater preserves the existing full catalog when a limited ticker run is requested.

### Examples

```bash
MAX_FETCHES=10 bun scripts/update-data.ts
TICKERS="FDN FTSM FJAN" bun scripts/update-data.ts
AUM="1B:" TER=":0.5" bun scripts/update-data.ts
PERFORMANCE_1Y="15:" bun scripts/update-data.ts
```

## TypeScript

The browser app is intentionally build-free: `index.html` carries the markup, styles and bootstrap, and `app.tsx` is TypeScript compiled in the browser with Babel standalone — no build step, no bundler, no `tsconfig.json` needed. Bun runs TypeScript out of the box.

Verification before every publish: `bun install --frozen-lockfile`, `bun test scripts/update-data.test.ts`, and `git diff --check`.

## Brands table

| Brand | Where to get the data |
| --- | --- |
| **abrdn (Aberdeen)** | [aberdeeninvestments.com](https://www.aberdeeninvestments.com/en-us/investor/funds/etfs) \| [aberdeen](https://daggerok.github.io/aberdeen/) |
| **Amplify** | [amplifyetfs.com](https://amplifyetfs.com/) \| [Amplify](https://daggerok.github.io/Amplify/) |
| **Capital Group** | [capitalgroup.com](https://www.capitalgroup.com/advisor/investments/exchange-traded-funds.html) \| [Capital-Group](https://daggerok.github.io/Capital-Group/) |
| **Fidelity** | [fidelity.com](https://www.fidelity.com/etfs) \| [Fidelity](https://daggerok.github.io/Fidelity/) |
| **First Trust** | [ftportfolios.com](https://www.ftportfolios.com/Retail/etf/etflist.aspx) \| [First-Trust](https://daggerok.github.io/First-Trust/) |
| **Franklin Templeton** | [franklintempleton.com](https://www.franklintempleton.com/investments/options/exchange-traded-funds) \| [Franklin](https://daggerok.github.io/Franklin/) |
| **Global X** | [globalxetfs.com/explore](https://www.globalxetfs.com/explore) \| [Global X](https://daggerok.github.io/Global-X/) |
| **Goldman Sachs** | [am.gs.com](https://am.gs.com/en-us/individual/funds?locale=en-us&audience=individual&sf=funds&filters=funds%7CETF&limit=100) \| [Goldman-Sachs](https://daggerok.github.io/Goldman-Sachs/) |
| **Invesco** | [invesco.com](https://www.invesco.com/us/en/financial-products/etfs.html) \| [Invesco](https://daggerok.github.io/Invesco/) |
| **iShares** | [ishares.com](https://www.ishares.com/) \| [iShares](https://daggerok.github.io/iShares/) |
| **JPMorgan** | [am.jpmorgan.com](https://am.jpmorgan.com/us/en/asset-management/adv/products/fund-explorer/etf) \| [JPMorgan](https://daggerok.github.io/JPMorgan/) |
| **NEOS** | [neosfunds.com](https://neosfunds.com/#explore-etfs) \| [Neos](https://daggerok.github.io/Neos/) |
| **Northern Trust** | [etfs.ntam.northerntrust.com](https://etfs.ntam.northerntrust.com/us/en/individual/funds) \| [Northern-Trust](https://daggerok.github.io/Northern-Trust/) |
| **ProShares** | [proshares.com](https://www.proshares.com/our-etfs/find-proshares-etfs) \| [ProShares](https://daggerok.github.io/ProShares/) |
| **Schwab** | [schwabassetmanagement.com](https://www.schwabassetmanagement.com/products) \| [Schwab](https://daggerok.github.io/Schwab/) |
| **SPDR** | [ssga.com](https://www.ssga.com/us/en/intermediary/etfs/fund-finder) \| [SPDR](https://daggerok.github.io/SPDR/) |
| **VanEck** | [vaneck.com](https://www.vaneck.com/us/en/etf-mutual-fund-finder/) \| [VanEck](https://daggerok.github.io/VanEck/) |
| **Vanguard** | [investor.vanguard.com](https://investor.vanguard.com/etf/list) \| [Vanguard](https://daggerok.github.io/Vanguard/) |
| **VictoryShares** | [vcm.com VictoryShares ETFs](https://www.vcm.com/products/victoryshares-etfs/victoryshares-etfs-list) \| [VictoryShares](https://daggerok.github.io/VictoryShares/) |
| **WisdomTree** | [wisdomtree.com](https://www.wisdomtree.com/investments) \| [WisdomTree](https://daggerok.github.io/WisdomTree/) |

## Sibling applications

| Application | Data provider | Repository |
| --- | --- | --- |
| abrdn (Aberdeen) | Official Aberdeen gateway + SEC N-PORT holdings fallback + Yahoo history/dividends | [aberdeen](https://github.com/daggerok/aberdeen) |
| Amplify | Amplify ETFs (Firestore data feed) | [Amplify](https://github.com/daggerok/Amplify) |
| Capital Group | Official Capital Group fund data + SEC N-PORT holdings fallback + Yahoo history fallback | [Capital-Group](https://github.com/daggerok/Capital-Group) |
| Fidelity | SEC EDGAR N-PORT-P + Yahoo Finance | [Fidelity](https://github.com/daggerok/Fidelity) |
| First Trust | ftportfolios.com official ETF list + fund summary, holdings, distribution and price-history export pages + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history fallback | [First-Trust](https://github.com/daggerok/First-Trust) |
| Franklin Templeton | franklintempleton.com ETF listings + product pages + SEC EDGAR N-PORT-P | [Franklin](https://github.com/daggerok/Franklin) |
| Global X | globalxetfs.com Next.js catalog and fund pages + dated full-holdings CSV | [Global X](https://github.com/daggerok/Global-X) |
| Goldman Sachs | am.gs.com fund finder + detail pages + SEC EDGAR N-PORT-P | [Goldman-Sachs](https://github.com/daggerok/Goldman-Sachs) |
| Invesco | invesco.com CSV downloads + Yahoo Finance | [Invesco](https://github.com/daggerok/Invesco) |
| iShares | iShares (BlackRock) product workbooks | [iShares](https://github.com/daggerok/iShares) |
| JPMorgan | am.jpmorgan.com fund explorer + product-data JSON | [JPMorgan](https://github.com/daggerok/JPMorgan) |
| NEOS | neosfunds.com lineup table + official fund pages + daily holdings CSV | [NEOS](https://github.com/daggerok/NEOS) |
| Northern Trust | etfs.ntam.northerntrust.com funds list + per-fund CSV/JSON downloads | [Northern-Trust](https://github.com/daggerok/Northern-Trust) |
| ProShares | proshares.com ETF finder + fund pages + official data host | [ProShares](https://github.com/daggerok/ProShares) |
| Schwab | schwabassetmanagement.com product pages + CSV exports | [Schwab](https://github.com/daggerok/Schwab) |
| SPDR | SSGA / State Street public feeds | [SPDR](https://github.com/daggerok/SPDR) |
| VanEck | vaneck.com ETF finder + product pages | [VanEck](https://github.com/daggerok/VanEck) |
| Vanguard | Vanguard product pages + SEC EDGAR N-PORT-P | [Vanguard](https://github.com/daggerok/Vanguard) |
| VictoryShares | VCM VictoryShares catalog and product JSON + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance adjusted-market-price history | [VictoryShares](https://github.com/daggerok/VictoryShares) |
| WisdomTree | WisdomTree product table + SEC EDGAR N-PORT-P + Yahoo Finance | [WisdomTree](https://github.com/daggerok/WisdomTree) |

## License

[MIT — same as all sibling ETF repositories.](./LICENSE)

First Trust, First Trust Portfolios L.P., First Trust Advisors L.P. and the fund names/tickers referenced here are trademarks of their respective owners. This is an independent, unofficial tool; it is not affiliated with, endorsed by, or sponsored by First Trust Portfolios L.P. or First Trust Advisors L.P. All data is reproduced from First Trust's public ftportfolios.com fund pages, public SEC EDGAR filings and Yahoo Finance for research purposes. All other trademarks, including index names, are the property of their respective owners.
