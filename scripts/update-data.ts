#!/usr/bin/env bun
// Bun provides Node-compatible fs/promises and process globals for this script.
/// <reference types="bun" />
import { readFile as outputReadFile, readdir as outputReadDir } from 'node:fs/promises';
import { createHash as outputCreateHash } from 'node:crypto';
import { join as outputJoin } from 'node:path';
import { fileURLToPath as outputFileURLToPath } from 'node:url';

// Console presentation; no changes to provider requests or persisted data.
/** Presentation only: no requests, writes, filtering, or changes to updater state. */

const outputClean = (value: unknown): string => String(value ?? 'null').replace(/[\r\n\t]+/g, ' ');
/** Presentation only: per-fund retry and fallback notices are printed when VERBOSE is enabled. */
const outputVerbose = (): boolean => /^(1|true|yes|on)$/i.test((globalThis as any).process?.env?.VERBOSE ?? '');
function outputNote(message: string): void { if (outputVerbose()) console.warn(message); }
/** Names are the canonical environment knobs, not internal parser properties. */
function outputConfigEntries(config: Record<string, any>): [string, string][] {
  const values = new Map<string, string>();
  const aliases: Record<string, string> = {
    requestSleepSeconds: 'REQUEST_SLEEP', categories: 'CATEGORY',
    aumRange: 'AUM', terRange: 'TER', dividendYieldRange: 'DIVIDEND_YIELD', secYieldRange: 'SEC_YIELD',
    performanceRanges: 'PERFORMANCE', totalReturnRanges: 'TOTAL_RETURN',
    skipVanEck: 'SKIP_VANECK', skipProShares: 'SKIP_PROSHARES',
    skipWisdomTree: 'SKIP_WISDOMTREE', skipGoldmanSachs: 'SKIP_GOLDMANSACHS',
    skipGlobalX: 'SKIP_GLOBALX', skipNorthernTrust: 'SKIP_NORTHERNTRUST',
  };
  const range = (v: any): string => typeof v === 'string' ? v : v?.source ?? `${Number.isFinite(v?.min) ? v.min : ''}:${Number.isFinite(v?.max) ? v.max : ''}`;
  for (const [key, value] of Object.entries(config)) {
    if (['proxyGapMs', 'fetchTimeoutMs', 'retryDelayMs'].includes(key)) continue;
    const name = aliases[key] ?? (/^[A-Z0-9_]+$/.test(key) ? key : key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase());
    if (name === 'PERFORMANCE' || name === 'TOTAL_RETURN') {
      for (const period of ['YTD', '1Y', '3Y', '5Y', '10Y']) values.set(`${name}_${period}`, range(value?.[period]));
    } else if (['AUM', 'TER', 'DIVIDEND_YIELD', 'SEC_YIELD'].includes(name)) {
      values.set(name, range(value));
    } else {
      values.set(name, value instanceof Set ? [...value].join(',') || 'all' : Array.isArray(value) ? value.join(',') || 'all' : outputClean(value));
    }
  }
  const first = ['MAX_FETCHES', 'REQUEST_SLEEP', 'CONCURRENCY'];
  return [...values].sort(([a], [b]) => {
    const ai = first.indexOf(a), bi = first.indexOf(b);
    return (ai < 0 ? first.length : ai) - (bi < 0 ? first.length : bi) || a.localeCompare(b);
  });
}
function outputConfigValue(key: string, value: string): string {
  if (/TOKEN|PASSWORD|SECRET|COOKIE|SEC_UA/i.test(key)) return '<redacted>';
  if (key === 'TICKERS' && ['', 'null', 'undefined'].includes(value)) return 'all';
  return outputClean(value);
}
function outputPrintConfig(brand: string, config: Record<string, any>): void {
  const entries: [string, string][] = [...outputConfigEntries(config), ['VERBOSE', String(outputVerbose())]];
  console.log(`[ config   ] ${brand} updater:\n${entries.map(([key, value]) => `              ${key}=${outputConfigValue(key, value)}`).join('\n')}`);
}
function outputHasOutputFilters(config: Record<string, any>): boolean {
  return outputConfigEntries(config).some(([name, value]) =>
    /^(CATEGORY|AUM|TER|DIVIDEND_YIELD|SEC_YIELD|PERFORMANCE_|TOTAL_RETURN_)/.test(name) &&
    !['', ':', 'null', 'all'].includes(value));
}
function outputPrintFilter(selected: number, total: number, deferred = false): void {
  console.log(`[ filter   ] ${selected} of ${total} funds ${deferred ? 'selected for evaluation (data-dependent filters applied per fund)' : 'pass filters'}`);
}
function outputStable(value: any): any {
  if (Array.isArray(value)) return value.map(outputStable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => !['generatedAt', 'catalogReadAt'].includes(key)).map(key => [key, outputStable(value[key])]));
  return value;
}
function outputContentKey(value: unknown): string { return JSON.stringify(outputStable(value)) ?? 'null'; }
async function outputInspectFund(root: URL | string, ticker: string): Promise<{ digest: string; meta: any }> {
  const dir = outputJoin(root instanceof URL ? outputFileURLToPath(root) : root, 'funds', ticker);
  const hash = outputCreateHash('sha256');
  async function visit(path: string): Promise<void> {
    const entries = await outputReadDir(path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) await visit(outputJoin(path, entry.name));
      else if (entry.name.endsWith('.json')) {
        const text = await outputReadFile(outputJoin(path, entry.name), 'utf8').catch(() => '');
        hash.update(outputJoin(path.slice(dir.length), entry.name));
        try { hash.update(outputContentKey(JSON.parse(text))); } catch { hash.update(text); }
      }
    }
  }
  await visit(dir);
  const meta = await outputReadFile(outputJoin(dir, 'meta.json'), 'utf8').then(JSON.parse).catch(() => ({}));
  return { digest: hash.digest('hex'), meta };
}
const outputCount = (value: any): unknown => typeof value === 'number' ? value : Array.isArray(value) ? value.length : value?.totalRows ?? value?.rows?.length ?? null;
const outputScalar = (value: any): any => value && typeof value === 'object' ? value.display ?? value.value ?? null : value;
const outputUnits: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12, THOUSAND: 1e3, MILLION: 1e6, BILLION: 1e9, TRILLION: 1e12 };
function outputMoney(value: any): string {
  const raw = value && typeof value === 'object' && typeof value.value === 'number' && Number.isFinite(value.value) ? value.value : outputScalar(value);
  if (raw === null || raw === undefined || raw === '—' || raw === '--') return 'null';
  const text = String(raw).replace(/[$,\s]/g, '');
  const match = text.match(/^([+-]?[\d.]+)(K|M|B|T|Thousand|Million|Billion|Trillion)?$/i);
  if (!match) return outputClean(raw);
  const number = Number(match[1]) * (outputUnits[match[2]?.toUpperCase() ?? ''] ?? 1);
  if (!Number.isFinite(number)) return 'null';
  for (const [unit, scale] of [['T', 1e12], ['B', 1e9], ['M', 1e6], ['K', 1e3]] as const) {
    if (Math.abs(number) >= scale) return `$${(number / scale).toFixed(1)}${unit}`;
  }
  return `$${number.toFixed(2)}`;
}
/** Yields: rounded to 2 decimals without trailing zeros; placeholders are omitted like null. */
function outputPercent(value: any): unknown {
  const raw = outputScalar(value);
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? Number(raw.toFixed(2)) : null;
  const text = String(raw).trim().replace(/%$/, '').trim();
  if (['', '-', '—', '--', 'n/a'].includes(text.toLowerCase())) return null;
  const number = Number(text.replace(/,/g, ''));
  return Number.isFinite(number) ? Number(number.toFixed(2)) : outputClean(raw);
}
function outputFundLine(index: number, total: number, ticker: string, status: string, data: any = {}, reason?: unknown): string {
  const width = Math.max(2, String(total).length);
  const metrics = data.metrics ?? {};
  // Presentation only. Keep valid zero/false values; omit unavailable fields.
  // outputMoney returns the string 'null' for an unavailable monetary value.
  const field = (key: string, value: unknown): string =>
    value === null || value === undefined || value === 'null' ? '' : `${key}=${outputClean(value)}`;
  const sources = [
    field('official', data.officialHistoryCount),
    field('yahoo', data.yahooHistoryCount),
  ].filter(part => part !== '').join(' ');
  const detail = [
    field('port', data.portId ?? data.portfolioId),
    field('history', outputCount(data.history ?? data.historyCount)),
    sources ? `(${sources})` : '',
    field('holdings', outputCount(data.holdings ?? data.holdingsCount)),
    field('divs', outputCount(data.worksheets?.Distributions ?? data.distributions)),
    field('netAssets', outputMoney(data.netAssets ?? data.aum)),
    field('total', outputMoney(data.totalFundNetAssets ?? data.totalNetAssets)),
    field('div', outputPercent(data.trailingYield ?? data.yields?.effectiveYield ?? data.yields?.dividendYield ?? data.dividendYield ?? metrics.dividendYield)),
    field('sec', outputPercent(data.secYield ?? data.yields?.secYield ?? metrics.secYield)),
    field('wp', data.workplaceRaw),
  ].filter(part => part !== '').join(' ');
  return `[ ${`${String(index).padStart(width)}/${total}`.padEnd(8)} ] ${outputClean(ticker).padEnd(5)} ${status.padEnd(9)}${detail ? ` ${detail}` : ''}${reason ? ` reason=${outputClean(reason)}` : ''}`;
}
function outputCreateReporter(root: URL | string, total: number) {
  let completed = 0;
  const tally = new Map<string, number>();
  return {
    before: (ticker: string) => outputInspectFund(root, ticker),
    async result(ticker: string, before: { digest: string }, status?: string, reason?: unknown, extra: any = {}) {
      const after = await outputInspectFund(root, ticker);
      const final = status ?? (before.digest === after.digest ? 'unchanged' : 'updated');
      tally.set(final, (tally.get(final) ?? 0) + 1);
      console.log(outputFundLine(++completed, total, ticker, final, { ...after.meta, ...extra }, reason));
    },
    /** First [ done ] line: the statuses of every fund line this reporter printed. */
    summary(startedAt: number): string {
      const order = ['updated', 'unchanged', 'kept', 'skipped', 'failed'];
      const statuses = [...order, ...[...tally.keys()].filter(status => !order.includes(status))];
      return `[ done     ] ${completed} fund${completed === 1 ? '' : 's'}: ${statuses.map(status => `${tally.get(status) ?? 0} ${status}`).join(', ')} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
    },
  };
}
/** Second [ done ] line: published totals. */
function outputCounts(funds: number, holdings: number, history: number): string {
  return `[ done     ] counts: ${funds.toLocaleString('en-US')} funds / ${holdings.toLocaleString('en-US')} holdings rows / ${history.toLocaleString('en-US')} history rows`;
}

// First Trust (ftportfolios.com) US ETF static data updater.
//
// Fetches the public First Trust ETF list (every listed First Trust ETF with
// its category, inception date, closing NAV, 30-day SEC yield and 12-month
// trailing distribution rate), the same list's "NAV performance" view (gross
// and net expense ratio plus official month-end NAV returns for every fund)
// and, per fund, the official summary, holdings, distribution-history and
// price-history pages, then writes a deterministic, paginated static JSON API
// under ./api/firsttrust — the same design as the daggerok/JPMorgan,
// daggerok/Neos and daggerok/ProShares updaters (zero dependencies, Bun only:
// node:fs/promises + node:zlib + fetch).
//
// Data sources
//   - catalog                 : ftportfolios.com etflist.aspx (server-rendered
//     ASP.NET HTML; the page without a Type= filter lists all ETFs) and
//     etflist.aspx?DisplayType=PerformanceNav (TER + month-end NAV returns)
//   - per-fund facts          : EtfSummary.aspx (CUSIP, ISIN, exchange,
//     inception, gross/net expense ratio, closing NAV / market price, bid/ask
//     premium, total net assets, shares, yields, month-end and quarter-end NAV
//     performance, benchmark)
//   - holdings                : EtfHoldings.aspx (the complete holdings table)
//   - distributions           : EtfDividHistory.aspx (one calendar year per page)
//   - history                 : EtfPriceHistory.aspx "Export Prices to Excel"
//     (ASP.NET form postback returning an XLSX workbook with the daily NAV,
//     market price and net assets since inception)
//   - holdings fallback       : SEC EDGAR Form N-PORT-P filings of the First
//     Trust ETF trusts (resolved per ticker; used only when the official
//     holdings table is empty or unreachable)
//   - history fallback        : Yahoo Finance public chart API (used only when
//     the official export is unavailable; Yahoo throttles data-center IPs)
//
// Usage: bun ./scripts/update-data.ts   (or ./scripts/update-data.ts --help)

import { mkdir, readFile, writeFile, readdir, rm, appendFile, rename } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// Constants and small helpers
// ---------------------------------------------------------------------------

type JsonRecord = Record<string, any>;

const FIRSTTRUST_SITE = 'https://www.ftportfolios.com';
const FIRSTTRUST_ETF_LIST = `${FIRSTTRUST_SITE}/Retail/etf/etflist.aspx`;
const FIRSTTRUST_PERFORMANCE_LIST = `${FIRSTTRUST_ETF_LIST}?DisplayType=PerformanceNav`;
const FIRSTTRUST_HOME = `${FIRSTTRUST_SITE}/retail/etf/home.aspx`;
const FIRSTTRUST_ETF_PATH = `${FIRSTTRUST_SITE}/Retail/Etf`;
const FIRSTTRUST_BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

export function firstTrustPageUrl(page: 'EtfSummary' | 'EtfHoldings' | 'EtfPriceHistory' | 'EtfDividHistory', ticker: string, extra = ''): string {
  return `${FIRSTTRUST_ETF_PATH}/${page}.aspx?Ticker=${encodeURIComponent(ticker)}${extra}`;
}

const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YAHOO_BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

const SEC_EFTS_HOST = 'https://efts.sec.gov/LATEST';
// Official SEC lookup tables (public, no key): ETF/mutual-fund ticker ->
// registrant CIK + series/class ids, and operating company name -> ticker.
const SEC_FUND_TICKERS_URL = 'https://www.sec.gov/files/company_tickers_mf.json';
const SEC_COMPANY_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
// SEC policy requires a declared contact; the repository Actions variable
// SEC_UA (or env SEC_UA) overrides this default.
const SEC_UA_DEFAULT = 'daggerok ETF feed daggerok@gmail.com';

let API_ROOT = new URL('../api/firsttrust/', import.meta.url);
let INDEX_FILE = new URL('index.json', API_ROOT);
let STATE_FILE = new URL('update-state.json', API_ROOT);

/** Points every read and write at another feed directory (tests run the whole pipeline in a temp dir). */
export function setApiRoot(root: URL): void {
  API_ROOT = root;
  INDEX_FILE = new URL('index.json', API_ROOT);
  STATE_FILE = new URL('update-state.json', API_ROOT);
}

const HOLDINGS_PAGE_SIZE_FALLBACK = 250;
const HISTORY_PAGE_SIZE_FALLBACK = 1000;
const CONCURRENCY_FALLBACK = 2;
const REQUEST_SLEEP_FALLBACK = 1;
const MAX_RETRIES_FALLBACK = 2;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const HOLDINGS_HEADERS = ['Name', 'Ticker', 'Identifier', 'Weight', 'Market Value', 'Shares Held', 'Asset Category'];
/** Funds whose holdings legitimately fail a holdingsGuard check (geared, futures, look-through, top-N lists): ticker, or '*' for every fund -> relaxed checks. */
export const HOLDINGS_GUARD_RELAX: Record<string, string[]> = {
  // futures and commodity strategy funds publish futures exposure as weights (sums 3.8 to 284 today)
  ESBG: ['sum'],
  FAAR: ['sum'],
  FMF: ['sum'],
  FTGC: ['sum'],
  // FT Vest single-stock "& Target Income" funds hold 3 to 9 lines: the stock, cash and an option package that is
  // restructured when it expires (2026-10-23: 9 rows with a box spread and FLEX options -> stock, US Dollar and one
  // short call, weights still sum to 100), so the row count halves on a real roll
  XVAD: ['count'],
  XVAP: ['count'],
  XVAZ: ['count'],
  XVGL: ['count'],
  XVMS: ['count'],
  XVMT: ['count'],
  XVNV: ['count'],
  XVPT: ['count'],
  XVSP: ['count'],
  XVTS: ['count'],
};
/** Funds the issuer closed, each confirmed from an SEC filing or the issuer notice (`source`): never fetched or guarded, last published data kept, index row marked closed. */
export const CLOSED_FUNDS: ClosedFund[] = [];
export const HISTORY_HEADERS = ['Date', 'NAV', 'Market Price', 'Premium/Discount', 'Total Net Assets'];
export const DISTRIBUTION_HEADERS = ['Ex-Date', 'Record Date', 'Payable Date', 'Distribution Amount', 'Distribution Type'];
const PROVIDER = 'First Trust Portfolios L.P. / First Trust Advisors L.P. official ftportfolios.com pages + Yahoo Finance chart (history fallback) + SEC EDGAR N-PORT-P (holdings fallback only)';
const SEC_TRUSTS = 'First Trust ETF trusts (e.g. First Trust Exchange-Traded Fund CIK 0001329377, First Trust Exchange-Traded AlphaDEX Fund CIK 0001383496); CIK resolved per ticker from SEC company_tickers_mf.json';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeTicker(raw: unknown): string {
  return String(raw ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function cleanText(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\u00ae/g, '') // ®
    .replace(/\u2122/g, '') // ™
    .replace(/&#174;|&reg;/gi, '')
    .replace(/&#8482;|&trade;/gi, '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '' || text === '—' || text === '-' || text === '--' || /^n\/?a$/i.test(text)) return null;
  // Percent first, then plain numbers: "0.40%" -> 0.4, "$1,234.56" -> 1234.56.
  const parsed = Number(text.replace(/[$,\s]/g, '').replace(/%$/i, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// "2026-06-30" -> "Jun 30 2026" (the display style shared with the sibling apps).
export function formatEdgarDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!match) return String(iso || '');
  const [, year, month, day] = match;
  return `${MONTHS[Number(month) - 1] ?? month} ${day} ${year}`;
}

export function epochToIsoDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

export function formatEpochDate(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  return `${MONTHS[date.getUTCMonth()]} ${String(date.getUTCDate()).padStart(2, '0')} ${date.getUTCFullYear()}`;
}

export function formatUsDate(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}/${date.getUTCFullYear()}`;
}

// "08/21/2026" / "2026-08-21T00:00:00Z" / "Aug 21, 2026" -> "2026-08-21" as plain calendar text (shared calendar-dates
// block, never the local time zone); anything else passes through untouched so an unexpected source format never
// silently corrupts a date column.
export function toIsoDate(raw: unknown): string {
  const text = String(raw ?? '').trim();
  return calendarIso(text) ?? text;
}

// ISO date -> epoch seconds (UTC midnight), NaN-safe.
export function isoToEpoch(iso: string): number | null {
  const value = Date.parse(`${toIsoDate(iso)}T00:00:00Z`);
  return Number.isFinite(value) ? Math.floor(value / 1000) : null;
}

/** First Trust lists and tables print two-digit years ("01/06/14"); page headers use four. */
export function firstTrustIsoDate(raw: unknown): string {
  // calendarIso reads two-digit years up to 69 as 20xx, from 70 as 19xx
  return toIsoDate(raw);
}

/** numberOrNull plus the accounting negatives "(1.25)" printed in First Trust holdings tables. */
export function toNumber(value: unknown): number | null {
  if (typeof value !== 'string') return numberOrNull(value);
  return numberOrNull(value.trim().replace(/^\((.*)\)$/, '-$1'));
}

function numberText(value: unknown): string {
  const number = toNumber(value);
  return number === null ? '' : String(number);
}

function displayDate(value: unknown): string {
  return formatEdgarDate(firstTrustIsoDate(value));
}

function formatMoney(value: number | null): string {
  if (value === null) return '—';
  for (const [unit, scale] of [['T', 1e12], ['B', 1e9], ['M', 1e6], ['K', 1e3]] as const) {
    if (Math.abs(value) >= scale) return `$${(value / scale).toFixed(2)}${unit}`;
  }
  return `$${value.toFixed(2)}`;
}

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}%`;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Updater configuration (environment variables, iShares/SPDR/JPMorgan-style)
// ---------------------------------------------------------------------------

type Range = { min?: number; max?: number };
type ReturnPeriod = 'YTD' | '1Y' | '3Y' | '5Y' | '10Y';
const RETURN_PERIODS: readonly ReturnPeriod[] = ['YTD', '1Y', '3Y', '5Y', '10Y'];
type RangeMap = Partial<Record<ReturnPeriod, Range>>;

type UpdaterConfig = {
  concurrency: number;
  requestSleep: number;
  maxFetches: number;
  holdingsPageSize: number;
  historyPageSize: number;
  maxRetries: number;
  tickers: string[];
  historyRange: string;
  secUa: string;
  skipYahoo: boolean;
  edgarFallback: boolean;
  aumRange?: Range & { source?: string };
  terRange?: Range;
  dividendYieldRange?: Range;
  secYieldRange?: Range;
  performanceRanges: RangeMap;
  totalReturnRanges: RangeMap;
};

const AUM_PRESET_BOUNDS = {
  nano: { min: 0, max: 10_000_000 },
  micro: { min: 10_000_000, max: 300_000_000 },
  small: { min: 300_000_000, max: 2_000_000_000 },
  mid: { min: 2_000_000_000, max: 10_000_000_000 },
  large: { min: 10_000_000_000, max: undefined },
} as const;
type AumPreset = keyof typeof AUM_PRESET_BOUNDS;

const AMOUNT_SUFFIXES: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

function envValue(env: Record<string, string | undefined>, name: string, aliases: string[] = []): string {
  for (const key of [`FIRSTTRUST_${name}`, name, ...aliases]) {
    const value = env[key];
    if (value !== undefined && value.trim() !== '') return value.trim();
  }
  return '';
}

function parsePositiveInt(raw: string, fallback: number): number {
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseNonNegativeFloat(raw: string, fallback: number): number {
  // Number('') is 0: an unset REQUEST_SLEEP must mean the default, not "no pacing".
  if (String(raw ?? '').trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function parseBoolean(raw: string, fallback = false): boolean {
  const text = String(raw ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  return fallback;
}

// Strict "min:max" ranges (same parser and errors as the sibling repos).
export function parseRange(raw: string, label: string): Range | undefined {
  const text = String(raw ?? '').trim();
  if (text === '' || text === ':') return undefined;
  if (!text.includes(':')) {
    throw new Error(`${label}: "${text}" must use the "min:max" range syntax (a colon is required)`);
  }
  const [rawMin, rawMax] = text.split(':', 2);
  const parseBound = (bound: string): number | undefined => {
    const cleaned = bound.trim().replace(/%$/, '').replace(/[$,]/g, '');
    if (cleaned === '') return undefined;
    const value = Number(cleaned);
    if (!Number.isFinite(value)) throw new Error(`${label}: "${bound.trim()}" is not a number`);
    return value;
  };
  const min = parseBound(rawMin);
  const max = parseBound(rawMax);
  if (min === undefined && max === undefined) return undefined;
  if (min !== undefined && max !== undefined && min > max) {
    throw new Error(`${label}: min (${min}) must not exceed max (${max})`);
  }
  return { min, max };
}

function parseAumBound(bound: string): number | undefined {
  const cleaned = bound.trim().replace(/[$,]/g, '');
  if (cleaned === '') return undefined;
  const suffixMatch = /^([\d.]+)([KMBT])$/i.exec(cleaned);
  if (suffixMatch) return Number(suffixMatch[1]) * (AMOUNT_SUFFIXES[suffixMatch[2].toUpperCase()] ?? 1);
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : undefined;
}

export function parseAumRange(raw: string): (Range & { source?: string }) | undefined {
  const text = String(raw ?? '').trim();
  if (text === '' || text === ':') return undefined;
  const lower = text.toLowerCase();
  for (const preset of Object.keys(AUM_PRESET_BOUNDS) as AumPreset[]) {
    if (lower === preset) return { ...AUM_PRESET_BOUNDS[preset] } as Range & { source?: string };
  }
  if (!text.includes(':')) {
    throw new Error(`AUM: "${text}" must use the "min:max" range syntax (a colon is required)`);
  }
  const [rawMin, rawMax] = text.split(':', 2);
  const min = parseAumBound(rawMin);
  const max = parseAumBound(rawMax);
  if (min === undefined && max === undefined) return undefined;
  if (min !== undefined && max !== undefined && min > max) {
    throw new Error(`AUM: min (${min}) must not exceed max (${max})`);
  }
  return { min, max };
}

function parseRanges(env: Record<string, string | undefined>, prefix: 'PERFORMANCE' | 'TOTAL_RETURN'): RangeMap {
  const ranges: RangeMap = {};
  for (const period of RETURN_PERIODS) {
    const parsed = parseRange(envValue(env, `${prefix}_${period}`), `${prefix}_${period}`);
    if (parsed) ranges[period] = parsed;
  }
  return ranges;
}

export function readConfig(env: Record<string, string | undefined> = process.env): UpdaterConfig {
  return {
    concurrency: parsePositiveInt(envValue(env, 'CONCURRENCY'), CONCURRENCY_FALLBACK),
    requestSleep: parseNonNegativeFloat(envValue(env, 'REQUEST_SLEEP'), REQUEST_SLEEP_FALLBACK),
    maxFetches: parsePositiveInt(envValue(env, 'MAX_FETCHES'), 0),
    holdingsPageSize: parsePositiveInt(envValue(env, 'HOLDINGS_PAGE_SIZE'), HOLDINGS_PAGE_SIZE_FALLBACK),
    historyPageSize: parsePositiveInt(envValue(env, 'HISTORY_PAGE_SIZE'), HISTORY_PAGE_SIZE_FALLBACK),
    maxRetries: parsePositiveInt(envValue(env, 'MAX_RETRIES'), MAX_RETRIES_FALLBACK),
    tickers: envValue(env, 'TICKERS')
      .split(/[\s,;]+/)
      .map(sanitizeTicker)
      .filter(Boolean),
    historyRange: normalizeHistoryRange(envValue(env, 'HISTORY_RANGE')),
    secUa: envValue(env, 'SEC_UA') || SEC_UA_DEFAULT,
    skipYahoo: parseBoolean(envValue(env, 'SKIP_YAHOO'), false),
    edgarFallback: parseBoolean(envValue(env, 'EDGAR_FALLBACK'), true),
    aumRange: parseAumRange(envValue(env, 'AUM')),
    terRange: parseRange(envValue(env, 'TER'), 'TER'),
    dividendYieldRange: parseRange(envValue(env, 'DIVIDEND_YIELD'), 'DIVIDEND_YIELD'),
    secYieldRange: parseRange(envValue(env, 'SEC_YIELD'), 'SEC_YIELD'),
    performanceRanges: parseRanges(env, 'PERFORMANCE'),
    totalReturnRanges: parseRanges(env, 'TOTAL_RETURN'),
  };
}

/** "max" (also the unset default) or a whole number of years ("10y"); anything else is an error, never a silent "max". */
export function normalizeHistoryRange(raw: string): string {
  const text = String(raw ?? '').trim().toLowerCase();
  if (text === '') return 'max';
  if (!/^(max|[1-9]\d*y)$/.test(text)) throw new Error('HISTORY_RANGE: expected "max" or "<N>y" (for example 10y)');
  return text;
}

// File defaults and explicit overrides: allowlisted scalar controls only, so
// GitHub Actions can resolve them without interpolating user input into bash.
// Precedence: config file < advanced JSON < nonblank inputs < environment
// (`FIRSTTRUST_<KEY>` alias wins over `<KEY>`).
export const CONTROL_NAMES = [
  'MAX_FETCHES', 'REQUEST_SLEEP', 'CONCURRENCY', 'MAX_RETRIES', 'HOLDINGS_PAGE_SIZE', 'HISTORY_PAGE_SIZE', 'HISTORY_RANGE',
  'TICKERS', 'AUM', 'TER', 'DIVIDEND_YIELD', 'SEC_YIELD',
  ...['PERFORMANCE', 'TOTAL_RETURN'].flatMap((prefix) => ['YTD', '1Y', '3Y', '5Y', '10Y'].map((period) => `${prefix}_${period}`)),
  'EDGAR_FALLBACK', 'SEC_UA', 'SKIP_YAHOO', 'VERBOSE', 'USE_SYSTEM_CA',
] as const;
export type ControlName = (typeof CONTROL_NAMES)[number];
export const CONFIG_FILE_URL = new URL('./update-data.config.json', import.meta.url);

export function resolveControls(
  file: unknown = {},
  advanced: unknown = {},
  inputs: unknown = {},
  env: Record<string, string | undefined> = {},
): Record<string, string> {
  const result: Record<string, string> = {};
  const known = new Set<string>(CONTROL_NAMES);
  const apply = (value: unknown, skipEmpty = false): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Configuration must be a JSON object');
    for (const [key, raw] of Object.entries(value)) {
      if (!known.has(key)) throw new Error(`Unknown updater control: ${key}`);
      if (skipEmpty && (raw === '' || raw === undefined || raw === null)) continue;
      if (!['string', 'number', 'boolean'].includes(typeof raw)) throw new Error(`${key}: expected string, number or boolean`);
      const text = String(raw);
      if (/[\r\n\0]/.test(text)) throw new Error(`${key}: multiline/control characters are not allowed`);
      result[key] = text;
    }
  };
  apply(file);
  apply(advanced);
  apply(inputs, true);
  for (const key of CONTROL_NAMES) {
    const value = env[`FIRSTTRUST_${key}`] ?? env[key];
    if (value !== undefined) apply({ [key]: value });
  }
  for (const key of ['MAX_FETCHES', 'CONCURRENCY', 'MAX_RETRIES', 'HOLDINGS_PAGE_SIZE', 'HISTORY_PAGE_SIZE']) {
    const v = result[key];
    if (v === undefined || v.trim() === '') continue;
    const min = key === 'MAX_FETCHES' ? 0 : 1;
    if (!/^\d+$/.test(v.trim()) || !Number.isSafeInteger(Number(v)) || Number(v) < min) throw new Error(`${key}: expected integer >= ${min}`);
  }
  if (result.REQUEST_SLEEP?.trim() && (!Number.isFinite(Number(result.REQUEST_SLEEP)) || Number(result.REQUEST_SLEEP) < 0)) throw new Error('REQUEST_SLEEP: expected nonnegative seconds');
  for (const key of ['SKIP_YAHOO', 'EDGAR_FALLBACK', 'VERBOSE']) {
    if (result[key]?.trim() && !/^(0|1|true|false|yes|no|y|n|on|off)$/i.test(result[key].trim())) throw new Error(`${key}: expected boolean`);
  }
  if (result.USE_SYSTEM_CA !== undefined) {
    const mode = result.USE_SYSTEM_CA.trim().toLowerCase();
    if (!['auto', 'true', 'false'].includes(mode)) throw new Error('USE_SYSTEM_CA: expected auto, true or false');
    result.USE_SYSTEM_CA = mode;
  }
  if (result.HISTORY_RANGE?.trim()) normalizeHistoryRange(result.HISTORY_RANGE);
  readConfig(result); // validate every min:max filter before any request or write
  return result;
}

export async function runtimeControls(env: Record<string, string | undefined> = process.env): Promise<Record<string, string>> {
  let file: unknown = {};
  try { file = JSON.parse(await readFile(CONFIG_FILE_URL, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return resolveControls(file, {}, {}, env);
}

// --- TLS trust store (identical in every ETF repo) ---
const SYSTEM_CA_MARKER = 'ETF_UPDATER_SYSTEM_CA';
const CERT_ERROR = /UNABLE_TO_GET_ISSUER_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT|CERT_HAS_EXPIRED|unable to get (?:local )?issuer certificate|self[- ]signed certificate|certificate has expired/i;

export function isCertError(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown; cause?: unknown } | null;
  return CERT_ERROR.test(`${String(e?.code ?? '')} ${String(e?.message ?? '')}`) || (e?.cause ? isCertError(e.cause) : false);
}

export function systemCaActive(env: Record<string, string | undefined> = process.env, execArgv: string[] = process.execArgv): boolean {
  return execArgv.includes('--use-system-ca') || env.NODE_USE_SYSTEM_CA === '1' || env[SYSTEM_CA_MARKER] === '1';
}

export function reexecWithSystemCa(): never {
  const child = Bun.spawnSync([process.execPath, '--use-system-ca', ...process.argv.slice(1)], {
    env: { ...process.env, [SYSTEM_CA_MARKER]: '1' },
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  process.exit(child.exitCode ?? 1);
}

/** mode: auto (restart once on an untrusted-certificate error), true (restart now), false (never). */
export function installSystemCa(mode: string, reexec: () => never = reexecWithSystemCa, active: boolean = systemCaActive()): void {
  if (mode === 'false' || active) return;
  if (mode === 'true') reexec();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    try { return await realFetch(...args); }
    catch (error) {
      if (!isCertError(error)) throw error;
      console.error('[ notice   ] TLS certificate not trusted; restarting once with --use-system-ca');
      return reexec();
    }
  }) as typeof fetch;
}

const USAGE = `
First Trust ETF static data updater (Bun, no dependencies).

  bun ./scripts/update-data.ts            update ./api/firsttrust from ftportfolios.com (+ SEC / Yahoo fallbacks)
  ./scripts/update-data.ts -h | --help    print this help

Controls (all optional; strict "min:max" ranges; AND logic). Defaults live in
scripts/update-data.config.json; precedence is file defaults < advanced JSON <
nonblank workflow inputs < environment variables (every name also accepts a
FIRSTTRUST_ prefix, which wins over the plain name):

  MAX_FETCHES          Batch size: continue after the ticker cursor saved in
                       api/firsttrust/update-state.json. Empty or 0 (the
                       default) means a full pass over every eligible fund,
                       stalest published as-of first; the cursor is reset.
  REQUEST_SLEEP        Minimum seconds between request starts in each worker
                       lane, including retries (default 1). Every fund needs
                       about 6 requests (summary, holdings, 2 price-history,
                       distribution years).
  CONCURRENCY          Parallel fund workers (default 2), each with its own
                       paced request lane.
  MAX_RETRIES          Retries after the initial request (integer >= 1, default 2). Only
                       network errors and HTTP 403/408/425/429/5xx responses
                       are retried with bounded exponential backoff.
  TICKERS              Space-, comma- or semicolon-separated ticker allowlist,
                       for example "FDN FTSM FJAN RDVY".
  AUM                  Total net assets range in USD: "min:max". Bounds accept
                       plain amounts or K/M/B/T suffixes; a whole-value preset
                       may be one of nano, micro, small, mid, large.
  TER                  Net expense ratio range in percent (after fee waivers; the total ratio when none).
  DIVIDEND_YIELD       12-month distribution rate range in percent.
  SEC_YIELD            30-day SEC yield range in percent.
  PERFORMANCE_YTD      Month-end NAV return ranges, average annualized for
                       periods of a year or more (also 1Y, 3Y, 5Y, 10Y).
  TOTAL_RETURN_YTD     Cumulative return ranges (also 1Y, 3Y, 5Y, 10Y).
  HOLDINGS_PAGE_SIZE   Rows per generated current-holdings JSON page (default 250).
  HISTORY_PAGE_SIZE    Rows per generated price-history JSON page (default 1000).
  HISTORY_RANGE        History window: max (default) or a whole number of
                       years such as 10y (official export and Yahoo fallback;
                       the Yahoo request uses explicit period1/period2).
                       Anything else is an error.
  EDGAR_FALLBACK       0/false to skip the SEC EDGAR Form N-PORT-P fallback for
                       funds whose official holdings table is empty (default
                       on).
  SEC_UA               Declared SEC User-Agent with a contact (SEC policy).
                       Default "daggerok ETF feed daggerok@gmail.com"; the
                       SEC_UA repository Actions variable overrides it.
  SKIP_YAHOO           1/true to never call the Yahoo chart API, even when the
                       official history export is unavailable for a fund
                       (previously published history rows are kept instead).
  VERBOSE              1/true to print per-fund retry and fallback notices.
  USE_SYSTEM_CA        auto (default) restarts the updater once with Bun's
                       --use-system-ca when a request fails with an untrusted
                       certificate error; true always uses the system CA store;
                       false never restarts.

TER, yield and return filters are evaluated against the freshly downloaded
ETF list values before the heavier per-fund downloads; an AUM filter reads
each candidate's summary page first. Funds that are filtered out (or that
fail) keep their previously published files, exactly like the sibling
updaters.

Examples:
  TICKERS="FDN FTSM FJAN RDVY" bun ./scripts/update-data.ts
  MAX_FETCHES=40 REQUEST_SLEEP=1.5 bun ./scripts/update-data.ts
  AUM=large TER=:0.6 bun ./scripts/update-data.ts
`;

// ---------------------------------------------------------------------------
// Fetch layer with global pacing and bounded retries (SPDR/Fidelity-style)
// ---------------------------------------------------------------------------

// One pacing lane per concurrent worker (sized from config.concurrency in
// main()). A single shared gate capped total throughput at one request per
// REQUEST_SLEEP no matter how high CONCURRENCY was set; CONCURRENCY workers
// now each get their own paced lane, so concurrency actually multiplies
// throughput as documented instead of only overlapping wait time.
let nextRequestAtLanes: number[] = [0];
let requestSleepMs = REQUEST_SLEEP_FALLBACK * 1000;

async function paceRequests(): Promise<void> {
  // Reserve the slot synchronously, before any await: two callers can never wait on the same slot and wake together.
  const now = Date.now();
  let lane = 0;
  for (let i = 1; i < nextRequestAtLanes.length; i++) if (nextRequestAtLanes[i] < nextRequestAtLanes[lane]) lane = i;
  const startAt = Math.max(now, nextRequestAtLanes[lane]);
  nextRequestAtLanes[lane] = startAt + requestSleepMs;
  if (startAt > now) await sleep(startAt - now);
}

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** `fetchWithRetry` already prefixes its messages with the fetch label, so a
    caller that prints its own tag must not repeat the label. */
function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^\[[^\]]*\] ?/, '');
}

let requestTimeoutMs = 45_000;

/** Per-request timeout (headers AND body); every attempt gets a fresh one and a timeout is retried like a network error. */
export function configureRequestTimeout(ms: number): void {
  requestTimeoutMs = ms;
}

export async function fetchWithRetry(
  url: string,
  label: string,
  init: RequestInit = {},
  maxRetries = 2,
): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await paceRequests();
    try {
      const timeout = AbortSignal.timeout(requestTimeoutMs);
      const response = await fetch(url, { redirect: 'follow', ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
      if (response.ok) {
        // Read the body inside the attempt so a stalled body is aborted by the same timeout and retried; callers get a buffered copy.
        const body = await response.arrayBuffer();
        return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      }
      const retryable = [403, 408, 425, 429].includes(response.status) || response.status >= 500;
      if (!retryable) throw new HttpError(`${label}: HTTP ${response.status} ${response.statusText}`, response.status, false);
      lastError = new HttpError(`${label}: HTTP ${response.status} (attempt ${attempt + 1} of ${maxRetries + 1})`, response.status, true);
    } catch (error) {
      if (error instanceof HttpError && !error.retryable) throw error;
      lastError = error instanceof HttpError ? error : new Error(`${label}: network error (${String(error)})`);
    }
    if (attempt < maxRetries) await sleep(Math.min(30_000, 1_000 * 2 ** attempt) + 250);
  }
  throw lastError instanceof Error ? lastError : new Error(`${label}: failed`);
}

function yahooHeaders(): Record<string, string> {
  return { 'User-Agent': YAHOO_BROWSER_UA, Accept: 'application/json' };
}

function secHeaders(config: UpdaterConfig): Record<string, string> {
  return { 'User-Agent': config.secUa, Accept: 'application/json,*/*' };
}

/** Sizes the per-worker pacing lanes (one lane per CONCURRENCY worker, REQUEST_SLEEP apart). */
export function configureRequestLanes(lanes: number, sleepSeconds: number): void {
  requestSleepMs = Math.max(0, sleepSeconds) * 1000;
  nextRequestAtLanes = new Array(Math.max(1, lanes)).fill(0);
}

function firstTrustHeaders(): Record<string, string> {
  return { 'User-Agent': FIRSTTRUST_BROWSER_UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' };
}

async function fetchText(url: string, label: string, headers: Record<string, string>, config: UpdaterConfig): Promise<string> {
  const response = await fetchWithRetry(url, label, { headers }, config.maxRetries);
  return await response.text();
}

async function fetchJson(url: string, label: string, headers: Record<string, string>, config: UpdaterConfig): Promise<JsonRecord> {
  const text = await fetchText(url, label, headers, config);
  try {
    return JSON.parse(text) as JsonRecord;
  } catch {
    throw new Error(`${label}: response is not valid JSON`);
  }
}

async function fetchFirstTrustPage(page: 'EtfSummary' | 'EtfHoldings' | 'EtfDividHistory', ticker: string, config: UpdaterConfig, extra = ''): Promise<string> {
  return fetchText(firstTrustPageUrl(page, ticker, extra), `[ product  ] ${ticker} ${page}`, firstTrustHeaders(), config);
}

// ---------------------------------------------------------------------------
// HTML helpers (daggerok/Neos, verbatim: tolerant of rows with missing </td>)
// ---------------------------------------------------------------------------

export function decodeHtmlEntities(text: string): string {
  return String(text ?? '')
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&rsquo;/gi, '’')
    .replace(/&lsquo;/gi, '‘')
    .replace(/&reg;/gi, '')
    .replace(/&trade;/gi, '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripTags(fragment: string): string {
  return decodeHtmlEntities(String(fragment ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export type HtmlTable = string[][];

/**
 * Split one `<tr>` into its cell texts.
 *
 * neosfunds.com ships several rows with a MISSING `</td>` (the ticker column of
 * XSPI/XQQI/XBCI/NEHI/MLPI/NLSI and the first cell of the Fund Details table),
 * so cells are cut on `<td` opening tags rather than paired with `</td>`: a
 * regex that requires a closing tag silently merges three columns into one.
 */
export function splitRowCells(rowHtml: string): string[] {
  const cells: string[] = [];
  const openings = [...rowHtml.matchAll(/<(td|th)\b[^>]*>/gi)];
  for (let index = 0; index < openings.length; index += 1) {
    const start = openings[index].index! + openings[index][0].length;
    const end = index + 1 < openings.length ? openings[index + 1].index! : rowHtml.length;
    let chunk = rowHtml.slice(start, end);
    // Drop a trailing closing tag only; a missing one must not swallow the value.
    chunk = chunk.replace(/<\/t[dh]>\s*$/i, '');
    cells.push(stripTags(chunk));
  }
  return cells;
}

export function parseHtmlTables(html: string): HtmlTable[] {
  const tables: HtmlTable[] = [];
  const tablePattern = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  for (const match of html.matchAll(tablePattern)) {
    const rows: HtmlTable = [];
    const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    for (const row of match[1].matchAll(rowPattern)) {
      cellsLoop: {
        // An unclosed final row would otherwise be dropped by the row regex, so
        // each row body is additionally scanned for orphan cells.
        const cells = splitRowCells(row[1]);
        if (cells.length) rows.push(cells);
        break cellsLoop;
      }
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}

/** Comments and <sup> footnote markers never carry values on ftportfolios.com pages. */
function withoutFootnotes(html: string): string {
  return String(html ?? '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, ' ');
}

/** Visible, cleaned text of an HTML fragment. */
export function htmlText(fragment: string): string {
  return cleanText(stripTags(withoutFootnotes(fragment)));
}

/** Rows of one `<table>` element as cleaned cell texts (th and td). */
export function tableRows(tableHtml: string): HtmlTable {
  const rows: HtmlTable = [];
  for (const row of withoutFootnotes(tableHtml).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = splitRowCells(row[1]).map(cleanText);
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function tablesByClass(html: string, className: string): string[] {
  const pattern = new RegExp(`<table\\b[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>[\\s\\S]*?<\\/table>`, 'gi');
  return [...withoutFootnotes(html).matchAll(pattern)].map((match) => match[0]);
}

function headerIndex(header: string[], ...names: string[]): number {
  const wanted = names.map((name) => name.toLowerCase());
  return header.findIndex((label) => wanted.includes(label.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Official ftportfolios.com parsers
// ---------------------------------------------------------------------------

export type ReturnSlot = 'mo3' | 'ytd' | 'yr1' | 'yr3' | 'yr5' | 'yr10' | 'sinceInception';
export type ReturnRow = { asOfDate: string | null } & Record<ReturnSlot, number | null>;
const RETURN_SLOTS: readonly ReturnSlot[] = ['mo3', 'ytd', 'yr1', 'yr3', 'yr5', 'yr10', 'sinceInception'];

export function emptyReturns(asOfDate: string | null = null): ReturnRow {
  return { asOfDate, mo3: null, ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null };
}

/** Header label -> numeric return slot ("Since Fund Inception", "3 Month", ...); null for anything else. */
export function returnSlot(label: string): ReturnSlot | null {
  const text = String(label ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (text === '3 month' || text === '3 months') return 'mo3';
  if (text === 'ytd' || text === 'year to date') return 'ytd';
  if (text === '1 year') return 'yr1';
  if (text === '3 year') return 'yr3';
  if (text === '5 year') return 'yr5';
  if (text === '10 year') return 'yr10';
  if (text.startsWith('since')) return 'sinceInception';
  return null;
}

/** Maps one performance row onto the return slots by its header labels (column order may vary). */
export function mapReturnRow(header: string[], values: string[], asOfDate: string | null): ReturnRow {
  const result = emptyReturns(asOfDate);
  header.forEach((label, index) => {
    const slot = returnSlot(label);
    if (slot && index < values.length && result[slot] === null) result[slot] = toNumber(values[index]);
  });
  return result;
}

/** Which definition stands behind `dividendYield` (index metrics key `dividendYieldBasis`). */
export type YieldBasis = 'official-trailing-12m' | 'official-distribution-rate' | 'official-other' | 'computed-trailing-12m' | 'indicated';
export const YIELD_BASES: readonly YieldBasis[] = ['official-trailing-12m', 'official-distribution-rate', 'official-other', 'computed-trailing-12m', 'indicated'];

/** Exhaustive lookup of every `yields.dividendYieldKind` text this updater has written. Unknown text: First Trust wording -> official-other, anything else -> indicated. */
export function yieldBasisFromKind(kind: unknown): YieldBasis {
  const text = typeof kind === 'string' ? kind : '';
  if (text.startsWith('First Trust published 12-month distribution rate')) return 'official-trailing-12m';
  if (text.startsWith('First Trust ETF list 12-month trailing distribution rate')) return 'official-trailing-12m';
  if (text.startsWith('Indicated from the latest ordinary distribution')) return 'indicated';
  return text.startsWith('First Trust') ? 'official-other' : 'indicated';
}

/** The code travels with the yield it describes: null exactly when the yield is null; a valid stored code wins; else the kind text; else official-other (a published yield of unknown definition). */
export function resolveYieldBasis(dividendYield: number | null, code: unknown, kind?: unknown): YieldBasis | null {
  if (dividendYield === null) return null;
  const known = YIELD_BASES.find((item) => item === code);
  if (known) return known;
  return typeof kind === 'string' && kind ? yieldBasisFromKind(kind) : 'official-other';
}

export type Fund = {
  ticker: string;
  name: string;
  category: string;
  navValue: number | null;
  aumValue: number | null;
  /** NET expense ratio (after the contractual fee waiver; the total ratio when no waiver is published). */
  terValue: number | null;
  netExpenseRatio: number | null;
  /** GROSS (total) expense ratio before waivers. */
  grossExpenseRatio: number | null;
  dividendYield: number | null;
  dividendYieldBasis: YieldBasis | null;
  secYield: number | null;
  unsubsidizedSecYield: number | null;
  inceptionListed: string | null;
  yieldAsOf: string | null;
  returns: { monthEnd: ReturnRow; quarterEnd: ReturnRow | null } | null;
  trustCik: string | null;
};
// The SEC resolution helpers are shared verbatim with daggerok/JPMorgan.
type CatalogFund = Fund;

export type ListTable = { category: string; header: string[]; rows: { ticker: string; name: string; cells: string[] }[] };

function categoryLabel(sectionTitle: string): string {
  return cleanText(decodeHtmlEntities(sectionTitle)).replace(/\s+Funds$/i, '') || 'Uncategorized';
}

/** Every category section of etflist.aspx (any DisplayType): header labels plus one row per ETF link. */
export function parseEtfListTables(html: string): ListTable[] {
  const parts = withoutFootnotes(html).split(/lblETFSectionTitle"[^>]*>([^<]*)</);
  const tables: ListTable[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const table: ListTable = { category: categoryLabel(parts[i]), header: [], rows: [] };
    for (const row of parts[i + 1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      if (/<th\b/i.test(row[1]) && !table.header.length) {
        table.header = splitRowCells(row[1]).map(cleanText);
        continue;
      }
      const link = /EtfSummary\.aspx\?Ticker=([A-Za-z0-9]+)['"][^>]*>([\s\S]*?)<\/a>/i.exec(row[1]);
      if (!link) continue;
      const ticker = sanitizeTicker(link[1]);
      const name = htmlText(link[2]);
      if (ticker && name) table.rows.push({ ticker, name, cells: splitRowCells(row[1]).map(cleanText) });
    }
    tables.push(table);
  }
  return tables;
}

function emptyFund(ticker: string, name: string, category: string): Fund {
  return {
    ticker, name, category, navValue: null, aumValue: null, terValue: null, netExpenseRatio: null, grossExpenseRatio: null,
    dividendYield: null, dividendYieldBasis: null, secYield: null, unsubsidizedSecYield: null, inceptionListed: null, yieldAsOf: null,
    returns: null, trustCik: null,
  };
}

/** Official ETF list (default view): category, inception, closing NAV, SEC yields, 12-month distribution rate. */
export function parseCatalogHtml(html: string): Fund[] {
  const byTicker = new Map<string, Fund>();
  for (const table of parseEtfListTables(html)) {
    const at = (...names: string[]): number => headerIndex(table.header, ...names);
    const inceptionAt = at('Inception Date'), navAt = at('Close NAV', 'Closing NAV', 'NAV');
    const secAt = at('30-Day SEC Yield'), unsubsidizedAt = at('Unsubsidized 30-Day SEC Yield');
    const rateAt = at('12-Month Trailing Distribution Rate', '12-Month Distribution Rate'), yieldAsOfAt = at('Yield As Of Date');
    const cell = (cells: string[], index: number): string => (index >= 0 ? cells[index] ?? '' : '');
    for (const row of table.rows) {
      if (byTicker.has(row.ticker)) continue;
      const fund = emptyFund(row.ticker, row.name, table.category);
      fund.inceptionListed = firstTrustIsoDate(cell(row.cells, inceptionAt)) || null;
      fund.navValue = toNumber(cell(row.cells, navAt));
      fund.secYield = toNumber(cell(row.cells, secAt));
      fund.unsubsidizedSecYield = toNumber(cell(row.cells, unsubsidizedAt));
      fund.dividendYield = toNumber(cell(row.cells, rateAt));
      fund.dividendYieldBasis = fund.dividendYield === null ? null : 'official-trailing-12m';
      fund.yieldAsOf = firstTrustIsoDate(cell(row.cells, yieldAsOfAt)) || null;
      byTicker.set(row.ticker, fund);
    }
  }
  return [...byTicker.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
}

export type CatalogPerformance = { inception: string | null; grossExpenseRatio: number | null; netExpenseRatio: number | null; monthEnd: ReturnRow };

/** etflist.aspx?DisplayType=PerformanceNav: gross/net expense ratio and month-end NAV returns of every ETF. */
export function parsePerformanceNavHtml(html: string): Map<string, CatalogPerformance> {
  const result = new Map<string, CatalogPerformance>();
  for (const table of parseEtfListTables(html)) {
    const at = (...names: string[]): number => headerIndex(table.header, ...names);
    const inceptionAt = at('Inception Date'), grossAt = at('Total Expense Ratio', 'Gross Expense Ratio');
    const netAt = at('Net Expense Ratio'), asOfAt = at('As Of Date');
    if (grossAt < 0 && !table.header.some((label) => returnSlot(label))) continue;
    for (const row of table.rows) {
      if (result.has(row.ticker)) continue;
      const asOf = asOfAt >= 0 ? firstTrustIsoDate(row.cells[asOfAt]) : '';
      result.set(row.ticker, {
        inception: inceptionAt >= 0 ? firstTrustIsoDate(row.cells[inceptionAt]) || null : null,
        grossExpenseRatio: grossAt >= 0 ? toNumber(row.cells[grossAt]) : null,
        netExpenseRatio: netAt >= 0 ? toNumber(row.cells[netAt]) : null,
        monthEnd: mapReturnRow(table.header, row.cells, /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : null),
      });
    }
  }
  return result;
}

export function applyCatalogPerformance(fund: Fund, performance: CatalogPerformance | undefined): Fund {
  if (!performance) return fund;
  fund.terValue = performance.netExpenseRatio ?? performance.grossExpenseRatio ?? fund.terValue;
  fund.netExpenseRatio = performance.netExpenseRatio;
  fund.grossExpenseRatio = performance.grossExpenseRatio ?? fund.grossExpenseRatio;
  fund.inceptionListed = fund.inceptionListed ?? performance.inception;
  fund.returns = { monthEnd: performance.monthEnd, quarterEnd: fund.returns?.quarterEnd ?? null };
  return fund;
}

type SummaryPair = { value: string; asOf: string | null };
export type Summary = {
  name: string | null;
  pairs: Record<string, SummaryPair>;
  navAsOf: string | null;
  expenseAsOf: string | null;
  benchmark: string | null;
  monthEnd: ReturnRow;
  quarterEnd: ReturnRow;
};

function asOfFrom(text: string): string | null {
  const match = /\(as of (\d{1,2}\/\d{1,2}\/\d{4})\)/i.exec(text);
  return match ? toIsoDate(match[1]) : null;
}

function parseReturnBlock(html: string, title: string): ReturnRow {
  const titleMatch = new RegExp(`${title} Performance\\s*\\(as of (\\d{1,2}/\\d{1,2}/\\d{4})\\)`, 'i').exec(html);
  if (!titleMatch) return emptyReturns();
  const asOfDate = toIsoDate(titleMatch[1]);
  const table = /<table\b[^>]*class="[^"]*\bfundGrid\b[^"]*"[^>]*>[\s\S]*?<\/table>/i.exec(html.slice(titleMatch.index))?.[0];
  if (!table) return emptyReturns(asOfDate);
  const rows = tableRows(table);
  const navRow = rows.find((row) => /^Net Asset Value \(NAV\)$/i.test(row[0] ?? ''));
  return navRow ? mapReturnRow(rows[0] ?? [], navRow, asOfDate) : emptyReturns(asOfDate);
}

/** Fund summary page: name/value pairs (with as-of dates) and the NAV performance rows. */
export function parseSummaryHtml(html: string): Summary {
  const body = String(html ?? '').replace(/<!--[\s\S]*?-->/g, ' ');
  const pairs: Record<string, SummaryPair> = {};
  for (const match of body.matchAll(/<td\b[^>]*class="CEFFieldLabel"[^>]*>([\s\S]*?)<\/td>\s*<td\b[^>]*class="CEFPagesBody"[^>]*>([\s\S]*?)<\/td>/gi)) {
    const rawLabel = match[1];
    const asOf = asOfFrom(htmlText(rawLabel));
    const label = htmlText(rawLabel.replace(/<span[^>]*>\s*\(as of[\s\S]*?<\/span>/gi, ' ')).replace(/\*+$/, '').trim();
    if (label && !(label in pairs)) pairs[label] = { value: htmlText(match[2]), asOf };
  }
  const headingName = /<title>([\s\S]*?)<\/title>/i.exec(body)?.[1];
  const name = headingName ? htmlText(headingName).replace(/\s*\([A-Z0-9]+\)\s*$/, '').trim() || null : null;
  const navHeader = /fundControlHeaderBar">\s*Current Fund Data\s*\(as of (\d{1,2}\/\d{1,2}\/\d{4})\)/i.exec(body);
  const expenseDate = /divExpenseRatioDate"[^>]*>\s*\*\s*As of (\d{1,2}\/\d{1,2}\/\d{4})/i.exec(body);
  const benchmark = /Index Performance[\s\S]{0,400}?<\/tr>\s*<tr>\s*<td\b[^>]*class="CEFPagesBody"[^>]*>([\s\S]*?)<\/td>/i.exec(body);
  return {
    benchmark: benchmark ? htmlText(benchmark[1]) || null : null,
    name,
    pairs,
    navAsOf: navHeader ? toIsoDate(navHeader[1]) : null,
    expenseAsOf: expenseDate ? toIsoDate(expenseDate[1]) : null,
    monthEnd: parseReturnBlock(body, 'Month End'),
    quarterEnd: parseReturnBlock(body, 'Quarter End'),
  };
}

export function summaryValue(summary: Summary, ...labels: string[]): SummaryPair | null {
  for (const label of labels) {
    const want = label.toLowerCase();
    for (const [key, pair] of Object.entries(summary.pairs)) if (key.toLowerCase() === want) return pair;
  }
  return null;
}

type SheetRow = Record<string, string>;

function isExchangeTicker(value: string): boolean {
  return /^[A-Z0-9][A-Z0-9./-]{0,14}$/.test(value) && /[A-Z]/.test(value);
}

/** Official holdings table (fundSilverGrid with a "Security Name" header). The column set varies by fund. */
export function parseHoldingsHtml(html: string): { headers: string[]; rows: SheetRow[]; asOfDate: string | null } {
  const asOf = /Holdings of the Fund as of\s*(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(htmlText(html));
  const rows: SheetRow[] = [];
  for (const table of tablesByClass(html, 'fundSilverGrid')) {
    const cells = tableRows(table);
    const header = cells[0] ?? [];
    const nameAt = headerIndex(header, 'Security Name'), weightAt = headerIndex(header, 'Weighting');
    if (nameAt < 0 || weightAt < 0) continue;
    const idAt = headerIndex(header, 'Identifier'), cusipAt = headerIndex(header, 'CUSIP'), classAt = headerIndex(header, 'Classification');
    const qtyAt = headerIndex(header, 'Shares / Quantity'), valueAt = headerIndex(header, 'Market Value');
    const cell = (row: string[], index: number): string => (index >= 0 ? row[index] ?? '' : '');
    for (const row of cells.slice(1)) {
      const name = cell(row, nameAt);
      if (!name) continue;
      const rawId = cell(row, idAt).replace(/\s+/g, ' ').trim();
      const cusip = cell(row, cusipAt).trim();
      const ticker = rawId && rawId !== cusip && isExchangeTicker(rawId) ? rawId : '';
      rows.push({
        Name: name,
        Ticker: ticker || '-',
        Identifier: cusip || (ticker ? '' : rawId) || '-',
        // a cell that is no number stays empty, never 0: the holdings guard then sees a broken sheet as broken (Q24)
        Weight: numberText(cell(row, weightAt)),
        'Market Value': numberText(cell(row, valueAt)),
        'Shares Held': numberText(cell(row, qtyAt)) || '-',
        'Asset Category': cell(row, classAt) || '-',
      });
    }
  }
  for (const row of rows) if (!row.Identifier) row.Identifier = '-';
  return { headers: HOLDINGS_HEADERS, rows, asOfDate: asOf ? toIsoDate(asOf[1]) : null };
}

export type Distributions = { headers: string[]; rows: string[][]; years: number[]; selectedYear: number | null };

/** Distribution history page (one calendar year per page); the dropdown lists the years that have distributions. */
export function parseDistributionHtml(html: string): Distributions {
  const body = String(html ?? '').replace(/<!--[\s\S]*?-->/g, ' ');
  const select = /<select\b[^>]*ddlDistributionHistoryYearSelection[^>]*>([\s\S]*?)<\/select>/i.exec(body)?.[1] ?? '';
  const years = [...select.matchAll(/<option\b[^>]*value="(\d{4})"/gi)].map((match) => Number(match[1])).sort((a, b) => a - b);
  const selectedMatch = /<option\b[^>]*selected="selected"[^>]*value="(\d{4})"/i.exec(select);
  const rows: string[][] = [];
  for (const table of tablesByClass(body, 'fundSilverGrid')) {
    const cells = tableRows(table);
    const header = cells[0] ?? [];
    const exAt = headerIndex(header, 'Ex-Date');
    if (exAt < 0) continue;
    const recordAt = headerIndex(header, 'Record Date'), payAt = headerIndex(header, 'Payable Date');
    const amountAt = headerIndex(header, 'Distribution Amount'), typeAt = headerIndex(header, 'Distribution Type');
    const cell = (row: string[], index: number): string => (index >= 0 ? row[index] ?? '' : '');
    for (const row of cells.slice(1)) {
      const ex = firstTrustIsoDate(row[exAt]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ex)) continue;
      const amount = toNumber(cell(row, amountAt));
      rows.push([ex, firstTrustIsoDate(cell(row, recordAt)), firstTrustIsoDate(cell(row, payAt)), amount === null ? '' : amount.toFixed(6), cell(row, typeAt)]);
    }
  }
  return { headers: DISTRIBUTION_HEADERS, rows, years, selectedYear: selectedMatch ? Number(selectedMatch[1]) : years.at(-1) ?? null };
}

/** Newest first, de-duplicated. Rows from freshly fetched years replace previously published rows of those years. */
export function mergeDistributionRows(fresh: string[][], previous: string[][], freshYears: Set<number>): string[][] {
  const kept = previous.filter((row) => !freshYears.has(Number(String(row[0]).slice(0, 4))));
  const seen = new Set<string>();
  const merged: string[][] = [];
  for (const row of [...fresh, ...kept]) {
    const key = row.join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }
  return merged.sort((a, b) => b[0].localeCompare(a[0]) || a.join('|').localeCompare(b.join('|')));
}

export function inferFrequency(isoDates: string[]): string | null {
  const dates = [...new Set(isoDates.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)))].sort();
  if (dates.length < 2) return null;
  const gaps = dates
    .slice(1)
    .map((date, i) => (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${dates[i]}T00:00:00Z`)) / 86_400_000)
    .filter((days) => days > 0);
  if (!gaps.length) return null;
  const average = gaps.reduce((sum, days) => sum + days, 0) / gaps.length;
  if (average <= 45) return 'Monthly';
  if (average <= 115) return 'Quarterly';
  if (average <= 220) return 'Semi-annually';
  if (average <= 400) return 'Annually';
  return 'Irregular';
}

/** Cadence from the latest year of ordinary distributions; latest ordinary amount and ex-date. */
export function summarizeDistributions(rows: string[][], today = new Date()): { frequency: string | null; latest: number | null; exDate: string | null } {
  const ordinary = rows.filter((row) => !/capital gain|return of capital/i.test(row[4] ?? '') && toNumber(row[3]) !== null);
  const sorted = [...ordinary].sort((a, b) => b[0].localeCompare(a[0]));
  const latest = sorted[0];
  if (!latest) return { frequency: null, latest: null, exDate: null };
  const newest = Date.parse(`${latest[0]}T00:00:00Z`);
  const recent = sorted.filter((row) => newest - Date.parse(`${row[0]}T00:00:00Z`) <= 400 * 86_400_000).map((row) => row[0]);
  const stale = today.getTime() - newest > 400 * 86_400_000;
  const frequency = stale ? null : inferFrequency(recent) ?? (recent.length === 1 ? 'Annually' : null);
  return { frequency, latest: toNumber(latest[3]), exDate: latest[0] };
}

export function parseHiddenInputs(html: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of String(html ?? '').matchAll(/<input\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/type="hidden"/i.test(tag)) continue;
    const name = /name="([^"]+)"/i.exec(tag)?.[1];
    if (!name) continue;
    result[decodeHtmlEntities(name)] = decodeHtmlEntities(/value="([^"]*)"/i.exec(tag)?.[1] ?? '');
  }
  return result;
}

// ---------------------------------------------------------------------------
// Price-history XLSX export (minimal zero-dependency OOXML reader)
// ---------------------------------------------------------------------------

/** First worksheet of an XLSX workbook as a row-major string grid. */
export function readXlsxRows(data: Uint8Array): string[][] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('XLSX: end of central directory not found');
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const files = new Map<string, string>();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('XLSX: bad central directory entry');
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(data.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    if (!/^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml|workbook\.xml)$/.test(name)) continue;
    const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const raw = data.subarray(start, start + compressedSize);
    const bytes = method === 0 ? raw : method === 8 ? inflateRawSync(raw) : null;
    if (!bytes) throw new Error(`XLSX: unsupported compression method ${method}`);
    files.set(name, decoder.decode(bytes));
  }
  const xmlText = (value: string): string => decodeHtmlEntities(value.replace(/<[^>]+>/g, ''));
  const shared = [...(files.get('xl/sharedStrings.xml') ?? '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)].map((match) =>
    [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((part) => xmlText(part[1])).join(''),
  );
  const sheetName = [...files.keys()].filter((name) => name.startsWith('xl/worksheets/')).sort()[0];
  if (!sheetName) throw new Error('XLSX: no worksheet found');
  const rows: string[][] = [];
  for (const row of (files.get(sheetName) ?? '').matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
    const cells: string[] = [];
    for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi)) {
      const attrs = cell[1];
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1] ?? '';
      const column = ref ? [...ref].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) - 1 : cells.length;
      const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? '';
      const inner = cell[2] ?? '';
      const value = /<v\b[^>]*>([\s\S]*?)<\/v>/i.exec(inner)?.[1] ?? '';
      let text = '';
      if (type === 's') text = shared[Number(value)] ?? '';
      else if (type === 'inlineStr') text = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((part) => xmlText(part[1])).join('');
      else text = xmlText(value);
      while (cells.length < column) cells.push('');
      cells[column] = text.trim();
    }
    rows.push(cells);
  }
  return rows;
}

type PriceDay = { date: string; nav: number | null; market: number | null; netAssets: number | null };

/** Official "Export Prices to Excel" grid: Date | Market Price | Net Asset Value | Bid/Ask Midpoint | Volume | Net Assets. */
export function parsePriceHistoryRows(grid: string[][]): PriceDay[] {
  const headerAt = grid.findIndex((row) => row.some((cell) => /^date$/i.test(cell)) && row.some((cell) => /net asset value/i.test(cell)));
  if (headerAt < 0) return [];
  const header = grid[headerAt].map((cell) => cell.toLowerCase());
  const at = (pattern: RegExp): number => header.findIndex((cell) => pattern.test(cell));
  const dateAt = at(/^date$/), marketAt = at(/^market price/), navAt = at(/^net asset value/), assetsAt = at(/^net assets/);
  const byDate = new Map<string, PriceDay>();
  for (const row of grid.slice(headerAt + 1)) {
    const raw = row[dateAt] ?? '';
    const serial = /^\d{5}(\.\d+)?$/.test(raw) ? new Date(Date.UTC(1899, 11, 30) + Math.round(Number(raw)) * 86_400_000).toISOString().slice(0, 10) : '';
    const date = serial || firstTrustIsoDate(raw);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const nav = toNumber(row[navAt]), market = toNumber(row[marketAt]);
    if (nav === null && market === null) continue;
    byDate.set(date, { date, nav, market, netAssets: assetsAt >= 0 ? toNumber(row[assetsAt]) : null });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function historySheetRows(days: PriceDay[]): SheetRow[] {
  return days.map((day) => ({
    Date: day.date,
    NAV: day.nav === null ? '' : String(round(day.nav, 4)),
    'Market Price': day.market === null ? '' : String(round(day.market, 4)),
    'Premium/Discount': day.nav !== null && day.market !== null && day.nav > 0 ? `${((day.market / day.nav - 1) * 100).toFixed(4)}%` : '',
    'Total Net Assets': day.netAssets === null ? '' : String(round(day.netAssets, 2)),
  }));
}

/**
 * HISTORY_RANGE shortens the request, never the published history: published rows dated before the first fresh row are kept
 * in front of it (FT-4). Callers pass previous rows only when they come from the same source as the fresh rows. The series are raw
 * NAV and market prices (no adjusted close to rescale), so the join is honest only when the published history has the first fresh
 * day with the same NAV and market price; otherwise (a gap, a revised or split-adjusted series) it returns null and the caller keeps
 * the fund as published. All official returns come from the summary page, so a window never nulls a return metric.
 */
export function withOlderHistory(fresh: SheetRow[], previous: SheetRow[]): SheetRow[] | null {
  const ordered = [...fresh].sort((a, b) => a.Date.localeCompare(b.Date));
  const first = ordered[0];
  if (!first?.Date) return fresh;
  const older = previous.filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.Date ?? '') && row.Date < first.Date).sort((a, b) => a.Date.localeCompare(b.Date));
  if (!older.length) return fresh;
  const same = (a: string | undefined, b: string | undefined): boolean => {
    const x = toNumber(a), y = toNumber(b);
    return x === null || y === null ? x === y : Math.abs(x - y) < 1e-6;
  };
  const joint = previous.find((row) => row.Date === first.Date);
  if (!joint || !same(joint.NAV, first.NAV) || !same(joint['Market Price'], first['Market Price'])) return null;
  return [...older, ...fresh];
}

const OFFICIAL_HISTORY_SOURCE = 'First Trust official daily NAV / market price history (ftportfolios.com EtfPriceHistory.aspx Excel export)';
const YAHOO_HISTORY_SOURCE = 'Yahoo Finance daily market-price chart (fallback; no NAV in this series)';

/** First export date for HISTORY_RANGE ("max", "10y", "6mo"), never before the fund's first price. */
export function historyStartDate(range: string, minDate: string, maxDate: string): string {
  const min = firstTrustIsoDate(minDate), max = firstTrustIsoDate(maxDate);
  const match = /^(\d+)(y)$/.exec(normalizeHistoryRange(range));
  if (!match || !/^\d{4}-\d{2}-\d{2}$/.test(max)) return min;
  const end = new Date(`${max}T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() - Number(match[1]) * 12);
  const start = end.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(min) && min > start ? min : start;
}

function usDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${Number(match[2])}/${Number(match[3])}/${match[1]}` : iso;
}

// ---------------------------------------------------------------------------
// Holding ticker resolution
//
// ftportfolios.com labels every exchange-listed holding with a ticker, but its
// bond, futures and cash rows either come back blank or carry a Bloomberg
// issuer code ("T" for Treasuries, "COF" for a Capital One bond) that is not
// an exchange ticker. Those rows keep "-" and are keyed by their CUSIP/SEDOL
// Identifier in the Watchlist — the exact convention daggerok/SPDR and
// daggerok/Fidelity use. N-PORT positions (EDGAR fallback) get tickers from the
// shared nport-reader block; normalizeHoldingName below compares the EDGAR
// full-text search registrant names with the fund name.
// ---------------------------------------------------------------------------

const HOLDING_NAME_SUFFIXES = new Set([
  'STOCK', 'COMMON', 'PREFERRED', 'PFD', 'SHARES', 'ORDINARY', 'DEPOSITARY', 'ADS', 'ADR',
  'INC', 'INCORPORATED', 'CORP', 'CORPORATION', 'CO', 'COMPANY', 'LTD', 'LIMITED', 'PLC',
  'PUBLIC', 'SA', 'SAS', 'SARL', 'SRL', 'SL', 'KG', 'AG', 'BA', 'BV', 'NV', 'OY', 'SE',
  'AS', 'AB', 'AD', 'KK', 'KABUSHIKI', 'KAISHA', 'PTY', 'PT', 'SFC', 'ANONIMA', 'GMBH',
  'HOLDINGS', 'HLDGS', 'DEL', 'NEW', 'DELISTED', 'REPR', 'GROUP', 'TR', 'TRUST', 'NOTE',
  'NL', 'SPA', 'LP', 'LC', 'LLC', 'CAP', 'STK', 'SHS',
  'NOTES', 'BOND', 'BONDS', 'SER', 'SERIES',
]);
const HOLDING_NAME_PHRASES = new Set([
  'COMMON STOCK', 'PREFERRED STOCK', 'DEPOSITARY SHARES', 'AMERICAN DEPOSITARY SHARES',
  'ORDINARY SHARES', 'LIABILITY CO', 'S A', 'N V', 'B V', 'PRIVATE LTD', 'PUBLIC LTD',
]);
// Words that carry no identity at all: dropped wherever they sit at the edge
// of a filed name, so "The Coca-Cola Co" and "Coca CO" meet.
const HOLDING_NAME_FILLERS = new Set([
  'THE', 'OF', 'AND', 'FOR', 'DE', 'LA', 'LE', 'VAN', 'VON', 'DER', 'DEN', 'DI', 'Y',
  'E', 'DU', 'DA', 'LOS', 'LAS', 'EL', 'AL', 'DEL', 'NPV', 'PAR', 'VAL', 'USD', 'EUR',
  'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'HKD', 'CNY', 'SEK', 'NOK', 'NZD', 'MXN', 'INR',
]);

// Trailing share-class / security-type designations. The class letter is kept
// and canonicalized ("... Class C Capital Stock" -> "... Cl C") rather than
// dropped, so GOOG vs GOOGL — like BF/A vs BF/B — never collide.
const SHARE_CLASS_RE = /(?:\s+(?:CLASS|CL))\s+([A-Z])\b\s*$/;
// Words that only describe the security, never the issuer; safe to peel off the
// end of a filed name (and, once a share class is known, from behind it).
const SECURITY_TYPE_WORDS = new Set([
  'STOCK', 'STK', 'SHARES', 'SHS', 'SH', 'SHARE', 'CAPITAL', 'CAP', 'COMMON', 'ORDINARY',
  'GENERAL', 'VOTING', 'NON', 'NONVOTING', 'NVOTING', 'CONVERTIBLE', 'DEPOSITARY', 'PAID',
  'SUBORDINATED', 'NOTES', 'NOTE', 'SER', 'SERIES', 'LIABILITY', 'NEW', 'REP', 'REPR',
]);

export function normalizeHoldingName(raw: unknown): string {
  const text = String(raw ?? '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
  let tokens = text.split(' ').filter(Boolean);
  let classLetter = '';
  let changed = true;
  while (changed && tokens.length > 1) {
    changed = false;
    const withClass = tokens.join(' ').match(SHARE_CLASS_RE);
    if (withClass) {
      classLetter = withClass[1];
      tokens = tokens.slice(0, tokens.length - 2); // drop "Class C" (or "Cl C")
      changed = true;
    }
    const last = tokens[tokens.length - 1];
    if (SECURITY_TYPE_WORDS.has(last) && tokens.length > 1) {
      tokens.pop(); // "... Capital Stock" -> "... Capital"
      changed = true;
      continue;
    }
    if (tokens.length >= 2 && HOLDING_NAME_PHRASES.has(`${tokens[tokens.length - 2]} ${last}`)) {
      tokens = tokens.slice(0, -2);
      changed = true;
      continue;
    }
    if (HOLDING_NAME_SUFFIXES.has(last)) {
      tokens.pop();
      changed = true;
      continue;
    }
    while (tokens.length > 2 && HOLDING_NAME_FILLERS.has(tokens[tokens.length - 1])) {
      tokens.pop(); // keep peeling: a filler may hide the next legal-form suffix
      changed = true;
    }
  }
  while (tokens.length > 1 && HOLDING_NAME_FILLERS.has(tokens[0])) tokens.shift();
  const body = tokens.join(' ').trim();
  return classLetter ? `${body} CL ${classLetter}`.replace(/\s+/g, ' ').trim() : body;
}

// ---------------------------------------------------------------------------
// SEC EDGAR fallback layer: N-PORT-P positions for funds ftportfolios.com does not publish holdings for. The shared
// nport-reader block at the end of this file finds, reads and checks the filing; this brand maps it to its sheet.
// ---------------------------------------------------------------------------

/**
 * The First Trust holdings sheet of an N-PORT filing: exactly HOLDINGS_HEADERS. A missing number stays empty (never 0), a
 * missing text is '-'. Tickers come from nportTickers, which gives one only to common stock: First Trust files some
 * preferreds under the issuer's common ticker (FPE 2026-07-31: an Equitable Holdings preferred as EQH), so preferred, debt,
 * fund and derivative rows stay identifier-keyed.
 */
export function nportHoldingsSheet(filing: NportFiling, tickers: ReadonlyArray<string>): { headers: string[]; rows: SheetRow[] } {
  const rows = filing.positions.map((position, index) => ({
    Name: position.name || '-',
    Ticker: tickers[index] || '-',
    Identifier: nportIdentifier(position) || '-',
    Weight: nportCell(position.weight),
    'Market Value': nportCell(position.value, 2),
    'Shares Held': nportCell(position.balance),
    'Asset Category': position.assetCat || '-',
  }));
  return { headers: HOLDINGS_HEADERS, rows };
}

// EDGAR full-text search maps a fund ticker to the registrant that filed its
// N-PORT-P, so the fallback works for every First Trust ETF without a hand-kept
// CIK table.
export function eftsSearchUrl(query: string): string {
  const params = new URLSearchParams({
    q: `"${query}"`,
    forms: 'NPORT-P',
    dateRange: 'custom',
    start: '0',
    end: String(25),
  });
  return `${SEC_EFTS_HOST}/search-index?${params.toString()}`;
}

export function pickEftsCik(payload: JsonRecord, fundName: string, warn: (message: string) => void = console.warn): string | null {
  // EDGAR returns { hits: { hits: [...] } }; older/simplified payloads (and the
  // unit-test fixtures) use a flat { hits: [...] } array.
  const hits: unknown[] = Array.isArray(payload?.hits)
    ? (payload.hits as unknown[])
    : Array.isArray((payload?.hits as JsonRecord)?.hits)
      ? ((payload.hits as JsonRecord).hits as unknown[])
      : [];
  const wanted = normalizeHoldingName(fundName);
  // An exact normalized-name match wins over earlier hits; otherwise the first hit that the old rule accepted
  // (a name that contains or is contained in the fund name, or a hit without names) is used, with a warning
  // when it was only a partial name match; otherwise the first First Trust registrant. The hits name the trust that
  // filed (FIRST TRUST EXCHANGE-TRADED FUND for ACYN), never the fund, so without that last rule no First Trust fund
  // ever resolved; the N-PORT reader then accepts only a filing whose series name is exactly the fund's.
  let fallback: { cik: string; partialName: string } | null = null;
  let trust: string | null = null;
  for (const raw of hits) {
    if (!raw || typeof raw !== 'object') continue;
    const hit = raw as JsonRecord;
    const source = (hit._source || {}) as JsonRecord;
    const display = source.display_names;
    // Real payload: display_names is ["NAME  (CIK 0001209466)", ...].
    const names: string[] = Array.isArray(display)
      ? display.map((entry: unknown) => String(entry))
      : Array.isArray((display as JsonRecord)?.names)
        ? ((display as JsonRecord).names as unknown[]).map((entry) => String(entry))
        : [];
    const fromDisplay = names.map((name) => /\(CIK\s*(\d{4,10})\)/i.exec(name)).find(Boolean);
    const ciks: string[] = Array.isArray(source.ciks) ? source.ciks.map((entry: unknown) => String(entry)) : [];
    const rawCik = String((display as JsonRecord)?.cik || fromDisplay?.[1] || ciks[0] || '');
    const cik = rawCik.replace(/\D/g, '').padStart(10, '0');
    if (!cik || cik === '0000000000') continue;
    if (wanted && names.length) {
      const normalizedNames = names.map((name) => normalizeHoldingName(name.replace(/\(CIK\s*\d+\)/i, ''))).filter(Boolean);
      if (normalizedNames.includes(wanted)) return cik;
      const near = normalizedNames.find((normalized) => wanted.includes(normalized) || normalized.includes(wanted));
      if (near) fallback ??= { cik, partialName: near };
      if (!trust && normalizedNames.some((name) => /^FIRST TRUST\b/.test(name))) trust = cik;
      continue;
    }
    fallback ??= { cik, partialName: '' };
  }
  if (fallback?.partialName) warn(`[ edgar    ] full-text search: "${fallback.partialName}" matches "${fundName}" only partially; using CIK ${fallback.cik}`);
  return fallback?.cik ?? trust;
}

// ---------------------------------------------------------------------------
// Yahoo chart layer: daily history, distributions, quote meta
// ---------------------------------------------------------------------------

export type ChartDay = { date: string; close: number; adjClose: number; volume: number };

export type ParsedChart = {
  exchangeName: string;
  longName: string;
  navPrice: number | null;
  regularMarketPrice: number | null;
  regularMarketTime: number | null;
  firstTradeDate: number | null;
  days: ChartDay[];
  dividends: Array<{ epoch: number; amount: number }>;
};

export function parseChart(payload: JsonRecord): ParsedChart {
  const result = (payload?.chart?.result || [])[0] as JsonRecord | undefined;
  if (!result) throw new Error('chart: empty result');
  const meta = (result.meta || {}) as JsonRecord;
  const timestamps: number[] = result.timestamp || [];
  const quote = ((result.indicators || {}).quote || [])[0] as JsonRecord | undefined;
  const adj = ((result.indicators || {}).adjclose || [])[0] as JsonRecord | undefined;
  const closes: unknown[] = (quote && quote.close) || [];
  const volumes: unknown[] = (quote && quote.volume) || [];
  const adjCloses: unknown[] = (adj && adj.adjclose) || closes;
  const days: ChartDay[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (typeof close !== 'number' || !Number.isFinite(close)) continue;
    const adjClose = typeof adjCloses[i] === 'number' && Number.isFinite(adjCloses[i] as number) ? (adjCloses[i] as number) : close;
    days.push({
      date: epochToIsoDate(timestamps[i]),
      close: round(close, 6),
      // Yahoo recomputes the split/dividend-adjusted close on every request;
      // at 6 decimals the last digit or two jitters between otherwise
      // identical requests, making every history row (and the fund) look
      // "updated" on every single run. 2 decimals is well past any
      // meaningful precision for a price and absorbs that jitter.
      adjClose: round(adjClose, 2),
      volume: typeof volumes[i] === 'number' ? (volumes[i] as number) : 0,
    });
  }
  const events = ((result.events || {}) as JsonRecord).dividends as Record<string, JsonRecord> | undefined;
  const dividends = Object.values(events || {})
    .map((event) => ({ epoch: Number(event.date), amount: Number(event.amount) }))
    .filter((event) => Number.isFinite(event.epoch) && Number.isFinite(event.amount) && event.amount > 0)
    .sort((a, b) => a.epoch - b.epoch);
  return {
    exchangeName: String(meta.fullExchangeName || meta.exchangeName || ''),
    longName: String(meta.longName || meta.shortName || ''),
    navPrice: numberOrNull(meta.navPrice),
    regularMarketPrice: numberOrNull(meta.regularMarketPrice) ?? numberOrNull(meta.previousClose),
    regularMarketTime: numberOrNull(meta.regularMarketTime),
    firstTradeDate: numberOrNull(meta.firstTradeDate),
    days,
    dividends,
  };
}

export function chartUrl(ticker: string, config: UpdaterConfig, nowMs: number = Date.now()): string {
  // Explicit period1/period2: `range=max` silently downgrades to monthly bars.
  const period2 = Math.floor(nowMs / 1000);
  let period1 = 0; // "max"
  const yearsMatch = /^(\d+)y$/i.exec(config.historyRange);
  if (yearsMatch) period1 = Math.floor(period2 - Number(yearsMatch[1]) * 365.25 * 86_400);
  return `${YAHOO_CHART_URL}/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d&events=div%7Csplit`;
}

// ---------------------------------------------------------------------------
// Derived metrics, filters and index entries
// ---------------------------------------------------------------------------

// (1 + CAGR)^n - 1 — the exact inverse of annualizing (same helper as SPDR).
export function annualizedToTotal(annualizedPercent: number | null | undefined, years: number): number | null {
  if (typeof annualizedPercent !== 'number' || !Number.isFinite(annualizedPercent)) return null;
  if (years <= 0) return null;
  return round(((1 + annualizedPercent / 100) ** years - 1) * 100, 2);
}

export function totalToAnnualized(totalPercent: number | null | undefined, years: number): number | null {
  if (typeof totalPercent !== 'number' || !Number.isFinite(totalPercent)) return null;
  if (years <= 0) return null;
  return round(((1 + totalPercent / 100) ** (1 / years) - 1) * 100, 2);
}

// Indicated yield: latest distribution x payments per year / price — used only
// when the product list publishes no trailing-12-month yield for the fund.
export function indicatedYield(
  latestDistribution: number | null | undefined,
  paymentsPerYear: number | null | undefined,
  price: number | null | undefined,
): number | null {
  if (typeof latestDistribution !== 'number' || typeof paymentsPerYear !== 'number' || typeof price !== 'number') return null;
  if (!Number.isFinite(latestDistribution) || !Number.isFinite(paymentsPerYear) || !Number.isFinite(price) || price <= 0) return null;
  if (paymentsPerYear <= 0 || latestDistribution <= 0) return null;
  return round(((latestDistribution * paymentsPerYear) / price) * 100, 2);
}
export function metricsFromReturns(monthEnd: ReturnRow): JsonRecord {
  return {
    ytd: monthEnd.ytd,
    tr1y: monthEnd.yr1,
    tr3y: annualizedToTotal(monthEnd.yr3, 3),
    tr5y: annualizedToTotal(monthEnd.yr5, 5),
    tr10y: annualizedToTotal(monthEnd.yr10, 10),
    cagr3y: monthEnd.yr3,
    cagr5y: monthEnd.yr5,
    cagr10y: monthEnd.yr10,
    siAnn: monthEnd.sinceInception,
  };
}

/** Years each published return slot needs: yr1 and since inception (annualized from one year on) one year, yr3/yr5/yr10 their tenor. */
const RETURN_HORIZONS: Record<string, number> = { yr1: 1, yr3: 3, yr5: 5, yr10: 10, sinceInception: 1 };

/**
 * The shared age rule on one performance table (month-end or quarter-end, official or from the catalog view): no figure for a
 * horizon the fund was too young for on the table's as-of date (calendar anniversary of its inception, inclusive; an unknown
 * date keeps the value). Applied before the table is published, so the metrics and both tables always agree.
 */
export function matureReturns(row: ReturnRow, inception: unknown): ReturnRow {
  return withoutYoungReturns(row, inception, row.asOfDate, RETURN_HORIZONS);
}

export const RETURNS_BASIS ='official First Trust NAV total returns (month-end performance table; cumulative 3y/5y/10y derived from the published annualized values)';

/** Mandatory metrics provenance: the basis label and the performance table date (never the NAV date). */
export function returnsProvenance(monthEnd: ReturnRow): JsonRecord {
  const asOf = firstTrustIsoDate(monthEnd.asOfDate);
  return { returnsBasis: RETURNS_BASIS, performanceAsOf: /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : null };
}

const PERIOD_SLOTS: Record<ReturnPeriod, ReturnSlot> = { YTD: 'ytd', '1Y': 'yr1', '3Y': 'yr3', '5Y': 'yr5', '10Y': 'yr10' };

/** Month-end NAV return for a filter period: annualized as published, or cumulative (total=true). */
export function returnForFilter(monthEnd: ReturnRow | null | undefined, period: ReturnPeriod, total: boolean): number | null {
  const value = monthEnd ? monthEnd[PERIOD_SLOTS[period]] : null;
  if (value === null || !total || period === 'YTD' || period === '1Y') return value;
  return annualizedToTotal(value, Number.parseInt(period, 10));
}

function inRange(value: number | null | undefined, range?: Range): boolean {
  if (!range) return true;
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (range.min !== undefined && value < range.min) return false;
  if (range.max !== undefined && value > range.max) return false;
  return true;
}

export function fundPasses(fund: Fund, config: UpdaterConfig): boolean {
  if (!inRange(fund.aumValue, config.aumRange) || !inRange(fund.terValue, config.terRange)) return false;
  if (!inRange(fund.dividendYield, config.dividendYieldRange) || !inRange(fund.secYield, config.secYieldRange)) return false;
  const monthEnd = fund.returns?.monthEnd;
  return RETURN_PERIODS.every(
    (period) =>
      inRange(returnForFilter(monthEnd, period, false), config.performanceRanges[period]) &&
      inRange(returnForFilter(monthEnd, period, true), config.totalReturnRanges[period]),
  );
}

function needsSummaryForFilters(fund: Fund, config: UpdaterConfig): boolean {
  if (config.aumRange && fund.aumValue === null) return true;
  if (config.terRange && fund.terValue === null) return true;
  return RETURN_PERIODS.some(
    (period) =>
      Boolean(config.performanceRanges[period] || config.totalReturnRanges[period]) && returnForFilter(fund.returns?.monthEnd, period, false) === null,
  );
}

/** Copies summary-page facts onto a catalog fund (AUM, TER, NAV, yields, official returns). */
export function applySummary(fund: Fund, summary: Summary): Fund {
  const gross = toNumber(summaryValue(summary, 'Total Expense Ratio', 'Gross Expense Ratio', 'Expense Ratio')?.value);
  const net = toNumber(summaryValue(summary, 'Net Expense Ratio')?.value);
  fund.terValue = net ?? gross ?? fund.terValue;
  fund.netExpenseRatio = net ?? fund.netExpenseRatio;
  fund.grossExpenseRatio = gross ?? fund.grossExpenseRatio;
  fund.aumValue = toNumber(summaryValue(summary, 'Total Net Assets', 'Net Assets')?.value) ?? fund.aumValue;
  fund.navValue = toNumber(summaryValue(summary, 'Closing NAV')?.value) ?? fund.navValue;
  fund.secYield = toNumber(summaryValue(summary, '30-Day SEC Yield')?.value) ?? fund.secYield;
  const summaryRate = toNumber(summaryValue(summary, '12-Month Distribution Rate')?.value);
  if (summaryRate !== null) { fund.dividendYield = summaryRate; fund.dividendYieldBasis = 'official-trailing-12m'; }
  if (summary.monthEnd.asOfDate) fund.returns = { monthEnd: summary.monthEnd, quarterEnd: summary.quarterEnd };
  return fund;
}

function fundPageUrl(ticker: string): string {
  return firstTrustPageUrl('EtfSummary', ticker);
}

function returnRowFrom(value: unknown): ReturnRow {
  const row = isRecord(value) ? value : {};
  const result = emptyReturns(typeof row.asOfDate === 'string' ? firstTrustIsoDate(row.asOfDate) || row.asOfDate : null);
  for (const slot of RETURN_SLOTS) result[slot] = toNumber(row[slot]);
  return result;
}

/** A published index entry turned back into a catalog fund (catalog outage fallback). */
function cachedFundFromIndex(item: JsonRecord): Fund {
  const metrics = isRecord(item.metrics) ? item.metrics : {};
  const fund = emptyFund(sanitizeTicker(item.ticker), String(item.name ?? ''), String(item.category ?? ''));
  fund.navValue = toNumber(item.navValue);
  fund.aumValue = toNumber(item.aumValue);
  fund.terValue = toNumber(item.terValue);
  fund.grossExpenseRatio = toNumber(item.terGrossValue);
  fund.dividendYield = toNumber(metrics.dividendYield);
  fund.dividendYieldBasis = resolveYieldBasis(fund.dividendYield, metrics.dividendYieldBasis);
  fund.secYield = toNumber(metrics.secYield);
  if (isRecord(item.returns)) fund.returns = { monthEnd: returnRowFrom(item.returns.monthEnd), quarterEnd: returnRowFrom(item.returns.quarterEnd) };
  return fund;
}

/** Values missing from the live catalog are taken from the previously published index entry. */
function mergePrevious(fund: Fund, previous: JsonRecord | undefined): Fund {
  if (!previous) return fund;
  const cached = cachedFundFromIndex(previous);
  fund.aumValue = fund.aumValue ?? cached.aumValue;
  fund.terValue = fund.terValue ?? cached.terValue;
  fund.grossExpenseRatio = fund.grossExpenseRatio ?? cached.grossExpenseRatio;
  if (fund.dividendYield === null) { fund.dividendYield = cached.dividendYield; fund.dividendYieldBasis = cached.dividendYieldBasis; }
  fund.secYield = fund.secYield ?? cached.secYield;
  fund.returns = fund.returns ?? cached.returns;
  return fund;
}

export function indexEntryFromMeta(fund: Fund, meta: JsonRecord): JsonRecord {
  const nav = isRecord(meta.nav) ? meta.nav : {};
  const market = isRecord(meta.marketPrice) ? meta.marketPrice : {};
  const aum = isRecord(meta.aum) ? meta.aum : {};
  const expense = isRecord(meta.expenseRatio) ? meta.expenseRatio : {};
  const ids = isRecord(meta.identifiers) ? meta.identifiers : {};
  const inception = isRecord(meta.inception) ? meta.inception : {};
  const returns = isRecord(meta.returns) ? meta.returns : {};
  const monthEnd = returnRowFrom(returns.monthEnd);
  const quarterEnd = returnRowFrom(returns.quarterEnd);
  const yields = isRecord(meta.yields) ? meta.yields : {};
  const distributions = isRecord(meta.distributions) ? meta.distributions : {};
  const premium = isRecord(meta.premiumDiscount) ? meta.premiumDiscount : {};
  const holdings = isRecord(meta.holdings) ? toNumber(meta.holdings.totalRows) ?? 0 : 0;
  const history = isRecord(meta.history) ? toNumber(meta.history.totalRows) ?? 0 : 0;
  const navValue = toNumber(nav.value), closeValue = toNumber(market.value), aumValue = toNumber(aum.value);
  // meta.json written before 2026-10-26 kept the gross ratio in expenseRatio.value: the published net wins.
  const terValue = toNumber(expense.net) ?? toNumber(expense.value), terGrossValue = toNumber(expense.gross);
  const dividendYield = toNumber(yields.dividendYield), secYield = toNumber(yields.secYield);
  const dividendYieldBasis = resolveYieldBasis(dividendYield, yields.dividendYieldBasis, yields.dividendYieldKind);
  const withDisplayDate = (row: ReturnRow): JsonRecord => ({ ...row, asOfDate: row.asOfDate ? displayDate(row.asOfDate) : null });
  return {
    ticker: fund.ticker,
    name: String(meta.name ?? fund.name),
    category: String(meta.category ?? fund.category),
    fundPage: fundPageUrl(fund.ticker),
    dataFile: `./funds/${fund.ticker}/meta.json`,
    ter: formatPercent(terValue),
    terValue,
    terGross: formatPercent(terGrossValue),
    terGrossValue,
    nav: navValue === null ? '—' : `$${navValue.toFixed(2)}`,
    navValue,
    aum: formatMoney(aumValue),
    aumValue,
    asOfDate: nav.asOfDate ? String(nav.asOfDate) : '—',
    inceptionDate: inception.fundInceptionDate ? displayDate(inception.fundInceptionDate) : '—',
    exchange: String(inception.exchange ?? '—'),
    closePrice: closeValue === null ? '—' : `$${closeValue.toFixed(2)}`,
    premiumDiscount: formatPercent(toNumber(premium.value)),
    cusip: ids.cusip ?? null,
    isin: ids.isin ?? null,
    distributions: {
      frequency: distributions.frequency ?? null,
      exDate: distributions.latestExDate ? displayDate(distributions.latestExDate) : '',
      dividend: distributions.latestAmount ?? '',
    },
    returns: { monthEnd: withDisplayDate(monthEnd), quarterEnd: withDisplayDate(quarterEnd) },
    metrics: {
      ...metricsFromReturns(monthEnd),
      dividendYield,
      dividendYieldText: dividendYield === null ? null : formatPercent(dividendYield),
      dividendYieldBasis,
      secYield,
      secYieldText: secYield === null ? null : formatPercent(secYield),
      ...returnsProvenance(monthEnd),
    },
    holdings,
    history,
  };
}

/** A previously published index row kept as is, with the current metrics key set and a dataFile that matches reality. */
export function normalizePreviousRow(row: JsonRecord, hasMeta: boolean, meta?: JsonRecord): JsonRecord {
  const returns = isRecord(row.returns) ? row.returns : {};
  const metrics = isRecord(row.metrics) ? row.metrics : {};
  const monthEnd = returnRowFrom(returns.monthEnd);
  const yields = meta && isRecord(meta.yields) ? meta.yields : {};
  const merged: JsonRecord = { ...metricsFromReturns(monthEnd), ...metrics, ytd: 'ytd' in metrics ? metrics.ytd : monthEnd.ytd };
  // The code is judged against the yield in this row: a stored code wins, then the meta kind text of the same yield, never a code for another yield.
  const dividendYield = toNumber(merged.dividendYield);
  const kind = toNumber(yields.dividendYield) === dividendYield ? yields.dividendYieldKind : undefined;
  const basis = resolveYieldBasis(dividendYield, merged.dividendYieldBasis, kind);
  const ordered: JsonRecord = {};
  for (const [key, value] of Object.entries(merged)) {
    if (key === 'dividendYieldBasis') continue;
    ordered[key] = value;
    if (key === 'dividendYieldText') ordered.dividendYieldBasis = basis;
  }
  if (!('dividendYieldBasis' in ordered)) ordered.dividendYieldBasis = basis;
  return { ...row, dataFile: hasMeta ? row.dataFile ?? `./funds/${row.ticker}/meta.json` : null, metrics: ordered };
}

/** Catalog-only entry (ETF list + NAV performance view) for funds that have never been fetched: no meta.json exists, so dataFile is null. */
export function catalogOnlyEntry(fund: Fund): JsonRecord {
  const nav = fund.navValue;
  const monthEnd = matureReturns(fund.returns?.monthEnd ?? emptyReturns(), fund.inceptionListed);
  const quarterEnd = matureReturns(fund.returns?.quarterEnd ?? emptyReturns(), fund.inceptionListed);
  const withDisplayDate = (row: ReturnRow): JsonRecord => ({ ...row, asOfDate: row.asOfDate ? displayDate(row.asOfDate) : null });
  return {
    ticker: fund.ticker,
    name: fund.name,
    category: fund.category,
    fundPage: fundPageUrl(fund.ticker),
    dataFile: null,
    ter: formatPercent(fund.terValue),
    terValue: fund.terValue,
    terGross: formatPercent(fund.grossExpenseRatio),
    terGrossValue: fund.grossExpenseRatio,
    nav: nav === null ? '—' : `$${nav.toFixed(2)}`,
    navValue: nav,
    aum: formatMoney(fund.aumValue),
    aumValue: fund.aumValue,
    asOfDate: '—',
    inceptionDate: fund.inceptionListed ? displayDate(fund.inceptionListed) : '—',
    exchange: '—',
    closePrice: '—',
    premiumDiscount: '—',
    cusip: null,
    isin: null,
    distributions: { frequency: null, exDate: '', dividend: '' },
    returns: { monthEnd: withDisplayDate(monthEnd), quarterEnd: withDisplayDate(quarterEnd) },
    metrics: {
      ...metricsFromReturns(monthEnd),
      dividendYield: fund.dividendYield,
      dividendYieldText: fund.dividendYield === null ? null : formatPercent(fund.dividendYield),
      dividendYieldBasis: resolveYieldBasis(fund.dividendYield, fund.dividendYieldBasis),
      secYield: fund.secYield,
      secYieldText: fund.secYield === null ? null : formatPercent(fund.secYield),
      ...returnsProvenance(monthEnd),
    },
    holdings: 0,
    history: 0,
  };
}

// ---------------------------------------------------------------------------
// Deterministic writers
// ---------------------------------------------------------------------------

const RUN_TIMESTAMP_KEYS = new Set(['generatedAt', 'savedAt', 'catalogReadAt']);

/** Recursively drops run timestamps so a run that only refreshed them is not a change. */
export function withoutRunTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutRunTimestamps);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !RUN_TIMESTAMP_KEYS.has(key)).map(([key, item]) => [key, withoutRunTimestamps(item)]));
}

export function samePublishedContent(previous: string, value: unknown): boolean {
  try {
    return JSON.stringify(withoutRunTimestamps(JSON.parse(previous))) === JSON.stringify(withoutRunTimestamps(value));
  } catch {
    return false;
  }
}

async function writeIfChanged(file: URL, value: unknown): Promise<boolean> {
  const next = `${JSON.stringify(value, null, 1)}\n`;
  let previous: string | null = null;
  try {
    previous = await readFile(file, 'utf8');
  } catch {
    // First write.
  }
  if (previous === next || (previous !== null && samePublishedContent(previous, value))) return false;
  await writeFileAtomic(file, next);
  return true;
}

/** Temp file + rename in the same directory: a crash or a timeout never leaves a half-written JSON file behind. */
export async function writeFileAtomic(file: URL, text: string): Promise<void> {
  await mkdir(new URL('.', file), { recursive: true });
  const temp = new URL(`${file.href}.${process.pid}.tmp`);
  try {
    await writeFile(temp, text, 'utf8');
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

function pad3(value: number): string {
  return String(value).padStart(3, '0');
}

export function buildPages<T>(rows: T[], pageSize: number): T[][] {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('pageSize must be a positive integer');
  const pages: T[][] = [];
  for (let offset = 0; offset < rows.length; offset += pageSize) pages.push(rows.slice(offset, offset + pageSize));
  return pages;
}

export function pageBasenames(paths: string[]): Set<string> {
  return new Set(paths.map((path) => path.split('/').at(-1) ?? path));
}

type PageManifest = { pages: string[]; pageSize: number; totalRows: number; asOfDate: string | null; source: string };

async function readJson(url: URL): Promise<unknown> {
  return readFile(url, 'utf8').then(JSON.parse).catch(() => null);
}

async function writePages(ticker: string, kind: 'holdings' | 'history', headers: string[], rows: JsonRecord[], size: number, asOfDate: string | null, source: string): Promise<PageManifest> {
  const dir = new URL(`funds/${ticker}/`, API_ROOT);
  const folder = new URL(`${kind}/`, dir);
  await mkdir(folder, { recursive: true });
  const pages: string[] = [];
  for (const [index, chunk] of buildPages(rows, size).entries()) {
    const name = `${kind}/${pad3(index + 1)}.json`;
    pages.push(name);
    await writeIfChanged(new URL(name, dir), { headers, rows: chunk, asOfDate });
  }
  return { pages, pageSize: size, totalRows: rows.length, asOfDate, source };
}

/** Removes page files the new manifest no longer lists; runs only AFTER the new meta.json is written. */
export async function pruneStalePages(ticker: string, kind: 'holdings' | 'history', pages: string[]): Promise<void> {
  const folder = new URL(`funds/${ticker}/${kind}/`, API_ROOT);
  const keep = pageBasenames(pages);
  for (const entry of await readdir(folder).catch(() => [])) {
    if (entry.endsWith('.json') && !keep.has(entry)) await rm(new URL(entry, folder), { force: true });
  }
}

async function previousRows(ticker: string, kind: 'holdings' | 'history'): Promise<SheetRow[]> {
  const meta = await readJson(new URL(`funds/${ticker}/meta.json`, API_ROOT));
  const manifest = isRecord(meta) ? meta[kind] : null;
  if (!isRecord(manifest) || !Array.isArray(manifest.pages)) return [];
  const rows: SheetRow[] = [];
  for (const name of manifest.pages) {
    if (typeof name !== 'string') continue;
    const page = await readJson(new URL(`funds/${ticker}/${name}`, API_ROOT));
    if (!isRecord(page) || !Array.isArray(page.rows)) continue;
    for (const row of page.rows) {
      if (isRecord(row)) rows.push(Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value ?? '')])));
    }
  }
  return rows;
}

async function readPreviousIndex(): Promise<Map<string, JsonRecord>> {
  const map = new Map<string, JsonRecord>();
  const payload = await readJson(INDEX_FILE);
  const funds = isRecord(payload) && Array.isArray(payload.funds) ? payload.funds : [];
  for (const fund of funds) if (isRecord(fund) && typeof fund.ticker === 'string') map.set(fund.ticker, fund);
  return map;
}

async function publishedFundTickers(): Promise<Set<string>> {
  const entries = await readdir(new URL('funds/', API_ROOT), { withFileTypes: true }).catch(() => []);
  const tickers = new Set<string>();
  for (const entry of entries) {
    if (entry.isDirectory() && (await readJson(new URL(`funds/${entry.name}/meta.json`, API_ROOT))) !== null) tickers.add(entry.name);
  }
  return tickers;
}

/** Any accepted date form ("2026-09-30", "Sep 30 2026", "9/30/2026") as an ISO day, or null. */
function isoDay(value: unknown): string | null {
  return calendarIso(value);
}

/**
 * ISO date a published index row is refreshed up to (the latest of its dated fields),
 * or null when the fund has no published data yet.
 */
export function publishedAsOf(row: JsonRecord | null | undefined): string | null {
  if (!row || row.dataFile === null) return null;
  const dates = [row.asOfDate, row.metrics?.performanceAsOf].map(isoDay).filter((value): value is string => value !== null);
  return dates.length ? dates.sort()[dates.length - 1] : null;
}

/**
 * Run order of an unbounded run: funds without published data first, then the stalest
 * published as-of, ties alphabetical. A run cut short by the soft deadline therefore
 * leaves the freshest funds for last, and the next run starts where this one stopped.
 */
export function stalestFirst<T extends { ticker: string }>(funds: T[], published: Map<string, JsonRecord>): T[] {
  const key = (fund: T): string => publishedAsOf(published.get(fund.ticker)) ?? '';
  return [...funds].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.ticker.localeCompare(b.ticker)));
}

/** One line for the log and the step summary: what a deadline-truncated run left behind. */
export function deadlineSummary(attempted: number, total: number, remaining: Array<{ ticker: string }>, published: Map<string, JsonRecord>): string {
  const ordered = stalestFirst(remaining, published);
  const oldest = ordered.length ? `${publishedAsOf(published.get(ordered[0].ticker)) ?? 'never published'} (${ordered[0].ticker})` : 'none';
  return `${attempted} of ${total} funds refreshed, ${remaining.length} keep their published state, oldest remaining published as-of: ${oldest}`;
}

type UpdateState = { cursor: string | null; savedAt: string };

async function readUpdateState(): Promise<UpdateState | null> {
  const state = await readJson(STATE_FILE);
  if (!isRecord(state)) return null;
  return { cursor: typeof state.cursor === 'string' ? state.cursor : null, savedAt: String(state.savedAt ?? '') };
}

async function writeUpdateState(lastProcessedTicker: string | null): Promise<void> {
  await writeIfChanged(STATE_FILE, {
    cursor: lastProcessedTicker,
    savedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  });
}

// ---------------------------------------------------------------------------
// Per-fund downloads (official pages first, then the fallbacks)
// ---------------------------------------------------------------------------

/** Official price-history XLSX export: GET the page, then post its ASP.NET form with the selected date range. */
async function fetchOfficialHistory(ticker: string, config: UpdaterConfig): Promise<PriceDay[]> {
  const url = firstTrustPageUrl('EtfPriceHistory', ticker);
  const first = await fetchWithRetry(url, `[ history  ] ${ticker} page`, { headers: firstTrustHeaders() }, config.maxRetries);
  const cookies = first.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ');
  const form = parseHiddenInputs(await first.text());
  const prefix = 'ctl00$ContentPlaceHolder1$PriceHistory$';
  const minDate = form[`${prefix}txtMinDate`] ?? '', maxDate = form[`${prefix}txtMaxDate`] ?? '';
  if (!minDate || !maxDate) throw new Error(`${ticker}: price history page exposed no date range`);
  const body = new URLSearchParams({
    ...form,
    [`${prefix}txtStartDate`]: usDate(historyStartDate(config.historyRange, minDate, maxDate)),
    [`${prefix}txtEndDate`]: maxDate,
    [`${prefix}btnDownload`]: 'Download',
  });
  const response = await fetchWithRetry(
    url,
    `[ history  ] ${ticker} xlsx`,
    {
      method: 'POST',
      body: body.toString(),
      headers: { ...firstTrustHeaders(), 'Content-Type': 'application/x-www-form-urlencoded', Referer: url, ...(cookies ? { Cookie: cookies } : {}) },
    },
    config.maxRetries,
  );
  const type = response.headers.get('content-type') ?? '';
  if (!/spreadsheetml|octet-stream|excel/i.test(type)) throw new Error(`${ticker}: price export returned ${type || 'unknown content'}`);
  return parsePriceHistoryRows(readXlsxRows(new Uint8Array(await response.arrayBuffer())));
}

async function fetchYahooChart(ticker: string, config: UpdaterConfig): Promise<ParsedChart> {
  return parseChart(await fetchJson(chartUrl(ticker, config), `[ chart    ] ${ticker}`, yahooHeaders(), config));
}

/** Documents the N-PORT name path reads at most (newest report period first): First Trust Exchange-Traded Fund VIII files up to 136 series per period. */
export const NPORT_NAME_PATH_DOCUMENTS = 150;

type NportHoldings = { rows: SheetRow[]; asOfDate: string | null; cik: string; accession: string; url: string };

/**
 * SEC EDGAR N-PORT-P holdings for one fund through the shared nport-reader block: the fund's own newest filing (its series id
 * from SEC's fund ticker table; a fund missing there is matched by its exact series name in the registrant found by the EDGAR
 * full-text search, never by a partial name), read only when strictly newer than the published holdings. Holdings that came
 * from an N-PORT filing are compared by the filing itself: the same filing is published again unchanged, another one must be newer.
 */
async function fetchEdgarHoldings(fund: Fund, published: JsonRecord, config: UpdaterConfig): Promise<NportHoldings | null> {
  if (!config.edgarFallback) return null;
  if (!config.secUa) {
    outputNote(`[ edgar    ] ${fund.ticker}: SEC fallback not attempted; configure SEC_UA with a valid organizational contact`);
    return null;
  }
  try {
    const ref = (await loadFundTickerTable(config).catch(() => null))?.get(fund.ticker) ?? null;
    const cik = ref?.cik || (await resolveRegistrantCik(fund, config));
    if (!cik) {
      outputNote(`[ edgar    ] ${fund.ticker}: no SEC registrant found`);
      return null;
    }
    const publishedAsOf = calendarIso(published.asOfDate) ?? '';
    const publishedRows = toNumber(published.totalRows) ?? 0;
    const fromNport = /^SEC EDGAR /.test(String(published.source ?? ''));
    const read = await readNportHoldings(
      { ticker: fund.ticker, cik, seriesId: ref?.seriesId || null, name: fund.name },
      fromNport ? { rows: 0 } : { asOf: publishedAsOf, rows: publishedRows },
      (url, label) => fetchText(url, `[ edgar    ] ${label}`, secHeaders(config), config),
      ref ? { cache: secState.reader } : { cache: secState.reader, maxDocuments: NPORT_NAME_PATH_DOCUMENTS },
    );
    if ('problem' in read) {
      outputNote(`[ edgar    ] ${read.problem}`);
      return null;
    }
    if (read.loose) {
      outputNote(`[ edgar    ] ${fund.ticker}: ${read.candidate.accession} names series "${read.filing.seriesName}", only a partial match of "${fund.name}"; not used`);
      return null;
    }
    const source = nportHoldingsSource(read.candidate.accession, read.filing.repPdDate);
    if (fromNport && source !== published.source && !nportIsFresh(read.filing.repPdDate, publishedAsOf, publishedRows)) {
      outputNote(`[ edgar    ] ${fund.ticker}: N-PORT ${read.filing.repPdDate || 'undated'} is not newer than the published holdings (${publishedAsOf || 'undated'}); not used`);
      return null;
    }
    const sheet = nportHoldingsSheet(read.filing, nportTickers(read.filing.positions, await loadCompanyNames(config).catch(() => null), await loadUsListings((url, label) => fetchText(url, `[ edgar    ] ${label}`, secHeaders(config), config))));
    return { rows: sheet.rows, asOfDate: read.filing.repPdDate || null, cik, accession: read.candidate.accession, url: read.url };
  } catch (error) {
    outputNote(`[ edgar    ] ${fund.ticker}: ${errorMessage(error)}`);
    return null;
  }
}

/** The holdings source of an N-PORT sheet; it names the filing, so a rerun can tell the same filing from another one. */
export function nportHoldingsSource(accession: string, repPdDate: string): string {
  return `SEC EDGAR Form N-PORT-P (accession ${accession}, report period ${repPdDate || 'n/a'})`;
}

async function fetchDistributions(ticker: string, previous: string[][], config: UpdaterConfig): Promise<string[][]> {
  const first = parseDistributionHtml(await fetchFirstTrustPage('EtfDividHistory', ticker, config));
  const fetched = new Set<number>();
  let fresh = first.rows;
  if (first.selectedYear !== null) fetched.add(first.selectedYear);
  const previousYears = previous.map((row) => Number(String(row[0]).slice(0, 4))).filter(Number.isFinite);
  const newestPublished = previousYears.length ? Math.max(...previousYears) : null;
  // First run: every listed year. Later runs: re-read the latest published year onwards and keep older published rows.
  const years = first.years.filter((year) => !fetched.has(year) && (newestPublished === null || year >= newestPublished - 1));
  for (const year of years) {
    const page = parseDistributionHtml(await fetchFirstTrustPage('EtfDividHistory', ticker, config, `&year=${year}&Print=Y`));
    fresh = [...fresh, ...page.rows.filter((row) => row[0].startsWith(String(year)))];
    fetched.add(year);
  }
  return mergeDistributionRows(fresh, previous, fetched);
}

const summaryCache = new Map<string, Summary>();

async function loadSummary(ticker: string, config: UpdaterConfig): Promise<Summary> {
  const cached = summaryCache.get(ticker);
  if (cached) return cached;
  const summary = parseSummaryHtml(await fetchFirstTrustPage('EtfSummary', ticker, config));
  summaryCache.set(ticker, summary);
  return summary;
}

const PAYMENTS_PER_YEAR: Record<string, number> = { Monthly: 12, Quarterly: 4, 'Semi-annually': 2, Annually: 1 };

type FundResult = { meta: JsonRecord; officialHistoryCount: number | null; yahooHistoryCount: number | null };

async function createMeta(fund: Fund, config: UpdaterConfig): Promise<FundResult> {
  const summary = await loadSummary(fund.ticker, config);
  const catalogRate = fund.dividendYield;
  const catalogBasis = resolveYieldBasis(catalogRate, fund.dividendYieldBasis);
  applySummary(fund, summary);
  const priorMeta = await readJson(new URL(`funds/${fund.ticker}/meta.json`, API_ROOT));
  const prior = isRecord(priorMeta) ? priorMeta : {};

  // Holdings: official HTML table -> SEC N-PORT-P -> previously published rows.
  let holdRows: JsonRecord[] = [];
  let holdingsAsOf: string | null = null;
  let holdingSource = 'First Trust official holdings page (ftportfolios.com EtfHoldings.aspx)';
  let holdingsFresh = false; // false while holdRows is empty or the previous run's sheet
  try {
    const holdings = parseHoldingsHtml(await fetchFirstTrustPage('EtfHoldings', fund.ticker, config));
    holdRows = holdings.rows;
    holdingsAsOf = holdings.asOfDate;
    holdingsFresh = holdRows.length > 0;
  } catch (error) {
    outputNote(`[ holdings ] ${fund.ticker}: ${errorMessage(error)}`);
  }
  const incomplete: string[] = [];
  const priorHoldings = isRecord(prior.holdings) ? prior.holdings : {};
  if (!holdRows.length) {
    // F: an N-PORT fallback never replaces fresher published holdings (strictly newer report period, the fund's own series).
    const sec = await fetchEdgarHoldings(fund, priorHoldings, config);
    if (sec) {
      holdRows = sec.rows;
      holdingsFresh = true;
      holdingsAsOf = sec.asOfDate;
      holdingSource = nportHoldingsSource(sec.accession, sec.asOfDate ?? '');
    }
  }
  if (!holdRows.length) {
    incomplete.push('holdings');
    const previous = await previousRows(fund.ticker, 'holdings');
    if (previous.length) {
      holdRows = previous;
      holdingsAsOf = isRecord(prior.holdings) && typeof prior.holdings.asOfDate === 'string' ? prior.holdings.asOfDate : null;
      holdingSource = 'previously published First Trust holdings (retained because the current sources returned none)';
    }
  }
  // Fresh holdings that look broken (no weight column, non-numeric weights, a bad weight sum, half the rows gone) never replace
  // the published ones: the fund fails like a required source and keeps its previous complete state (nothing is written yet).
  // Q24: whatever is relaxed, a sheet without a single numeric weight never replaces published numeric weights.
  const publishedWeights = holdingsFresh && isRecord(prior.holdings) ? holdingsWeightCount(HOLDINGS_HEADERS, await previousRows(fund.ticker, 'holdings')) : null;
  const holdingsProblem = holdingsFresh
    ? holdingsGuard(HOLDINGS_HEADERS, holdRows, isRecord(prior.holdings) ? toNumber(prior.holdings.totalRows) : null, HOLDINGS_GUARD_RELAX[fund.ticker] ?? HOLDINGS_GUARD_RELAX['*'] ?? [], publishedWeights)
    : null;
  if (holdingsProblem) throw new Error(`holdings guard: ${holdingsProblem}; ${Object.keys(prior).length ? 'kept the previous complete data' : 'no data published for this fund yet'}`);

  // History: official XLSX export -> Yahoo market closes -> previously published rows.
  // A fund whose published history is the official NAV series never swaps it for Yahoo market closes (no NAV, no net assets):
  // a failed export keeps the whole fund as published (FT-3). Yahoo stays the fallback for a fund with no official history yet.
  const priorHistorySource = isRecord(prior.history) && typeof prior.history.source === 'string' ? prior.history.source : '';
  const priorOfficialHistory = priorHistorySource === OFFICIAL_HISTORY_SOURCE;
  let historyRowsOut: SheetRow[] = [];
  let historySource = '';
  let historyAsOf: string | null = null;
  let officialHistoryCount: number | null = null;
  let yahooHistoryCount: number | null = null;
  try {
    const days = await fetchOfficialHistory(fund.ticker, config);
    if (days.length) {
      const joined = withOlderHistory(historySheetRows(days), priorOfficialHistory ? await previousRows(fund.ticker, 'history') : []);
      if (!joined) throw new Error('kept previous published state: the official history window does not join the published history (gap or revised prices)');
      historyRowsOut = joined;
      historyAsOf = days.at(-1)?.date ?? null;
      officialHistoryCount = days.length;
      historySource = OFFICIAL_HISTORY_SOURCE;
    }
  } catch (error) {
    outputNote(`[ history  ] ${fund.ticker}: ${errorMessage(error)}`);
  }
  if (!historyRowsOut.length && !config.skipYahoo && !priorOfficialHistory) {
    try {
      const chart = await fetchYahooChart(fund.ticker, config);
      if (chart.days.length) {
        const fresh = historySheetRows(chart.days.map((day) => ({ date: day.date, nav: null, market: day.close, netAssets: null })));
        const joined = withOlderHistory(fresh, priorHistorySource === YAHOO_HISTORY_SOURCE ? await previousRows(fund.ticker, 'history') : []);
        if (!joined) throw new Error('kept previous published state: the Yahoo history window does not join the published history (gap or revised prices)');
        historyRowsOut = joined;
        historyAsOf = chart.days.at(-1)?.date ?? null;
        yahooHistoryCount = chart.days.length;
        historySource = YAHOO_HISTORY_SOURCE;
      }
    } catch (error) {
      outputNote(`[ chart    ] ${fund.ticker}: ${errorMessage(error)}`);
    }
  }
  if (!historyRowsOut.length) {
    incomplete.push('history');
    historyRowsOut = await previousRows(fund.ticker, 'history');
    historyAsOf = historyRowsOut.at(-1)?.Date ?? null;
    historySource = historyRowsOut.length
      ? 'previously published history retained because the official export and Yahoo were unavailable'
      : 'history unavailable; nothing has been published yet';
  }

  // Distributions: official per-year pages (incremental), previously published rows kept.
  const priorDist = isRecord(prior.distributions) && Array.isArray(prior.distributions.rows)
    ? prior.distributions.rows.filter((row: unknown): row is unknown[] => Array.isArray(row)).map((row: unknown[]) => row.map((cell) => String(cell ?? '')))
    : [];
  let distRows: string[][] = priorDist;
  let distributionSource = 'previously published First Trust distribution history (current request failed)';
  try {
    distRows = await fetchDistributions(fund.ticker, priorDist, config);
    distributionSource = 'First Trust official distribution history (ftportfolios.com EtfDividHistory.aspx, all listed years)';
  } catch (error) {
    incomplete.push('distributions');
    outputNote(`[ history  ] ${fund.ticker} distributions: ${errorMessage(error)}`);
  }
  const distSummary = summarizeDistributions(distRows);

  // C: a fund is either fully updated or fully kept. When a required source failed and the fund already has a published state,
  // nothing is written (no new returns next to stale holdings, history or distributions); the previous state stays as it is.
  if (incomplete.length && Object.keys(prior).length) {
    throw new Error(`kept previous published state: ${incomplete.join(', ')} unavailable in this run`);
  }

  const hManifest = await writePages(fund.ticker, 'holdings', HOLDINGS_HEADERS, holdRows, config.holdingsPageSize, holdingsAsOf, holdingSource);
  const yManifest = await writePages(fund.ticker, 'history', HISTORY_HEADERS, historyRowsOut, config.historyPageSize, historyAsOf, historySource);

  const pair = (...labels: string[]): SummaryPair | null => summaryValue(summary, ...labels);
  const nav = toNumber(pair('Closing NAV')?.value) ?? fund.navValue;
  const market = toNumber(pair('Closing Market Price')?.value);
  const premium = toNumber(pair('Bid/Ask Premium', 'Bid/Ask Premium/Discount')?.value);
  const aum = toNumber(pair('Total Net Assets', 'Net Assets')?.value) ?? fund.aumValue;
  const gross = toNumber(pair('Total Expense Ratio', 'Gross Expense Ratio', 'Expense Ratio')?.value) ?? fund.grossExpenseRatio;
  const net = toNumber(pair('Net Expense Ratio')?.value) ?? fund.netExpenseRatio;
  const ter = net ?? gross;
  const secYield = toNumber(pair('30-Day SEC Yield')?.value) ?? fund.secYield;
  const ratePair = pair('12-Month Distribution Rate');
  const rate12 = toNumber(ratePair?.value);
  const indicated = indicatedYield(distSummary.latest, PAYMENTS_PER_YEAR[distSummary.frequency ?? ''] ?? null, market);
  const dividendYield = rate12 ?? catalogRate ?? indicated;
  const dividendYieldBasis: YieldBasis | null = rate12 !== null ? 'official-trailing-12m' : catalogRate !== null ? catalogBasis : indicated !== null ? 'indicated' : null;
  const navAsOf = summary.navAsOf ?? historyAsOf;
  const inception = firstTrustIsoDate(pair('Inception')?.value) || fund.inceptionListed || null;
  const monthEnd = matureReturns(summary.monthEnd.asOfDate ? summary.monthEnd : fund.returns?.monthEnd ?? emptyReturns(), inception);
  const quarterEnd = matureReturns(summary.quarterEnd.asOfDate ? summary.quarterEnd : fund.returns?.quarterEnd ?? emptyReturns(), inception);
  const meta: JsonRecord = {
    ticker: fund.ticker,
    name: fund.name,
    category: fund.category,
    source: {
      fundPage: fundPageUrl(fund.ticker),
      catalog: FIRSTTRUST_ETF_LIST,
      catalogPerformance: FIRSTTRUST_PERFORMANCE_LIST,
      issuerHome: FIRSTTRUST_HOME,
      holdingsPage: firstTrustPageUrl('EtfHoldings', fund.ticker),
      historyPage: firstTrustPageUrl('EtfPriceHistory', fund.ticker),
      distributionPage: firstTrustPageUrl('EtfDividHistory', fund.ticker),
      yahooChart: `${YAHOO_CHART_URL}/${fund.ticker}`,
      holdingsSource: holdingSource,
      historySource,
      distributionSource,
      provider: PROVIDER,
    },
    fundType: pair('Fund Type')?.value || null,
    identifiers: { cusip: pair('CUSIP')?.value || null, isin: pair('ISIN')?.value || null, iopv: pair('Intraday NAV')?.value || null, indexTicker: summary.benchmark },
    inception: { fundInceptionDate: inception, exchange: pair('Exchange')?.value || null },
    expenseRatio: { display: formatPercent(ter), value: ter, gross, net, asOfDate: summary.expenseAsOf ?? pair('Total Expense Ratio')?.asOf ?? null },
    nav: { display: nav === null ? null : `$${nav.toFixed(2)}`, value: nav, asOfDate: navAsOf ? displayDate(navAsOf) : null },
    marketPrice: { display: market === null ? null : `$${market.toFixed(2)}`, value: market, asOfDate: navAsOf ? displayDate(navAsOf) : null },
    premiumDiscount: { display: formatPercent(premium), value: premium, basis: 'First Trust published bid/ask premium' },
    aum: { display: formatMoney(aum), value: aum, asOfDate: navAsOf ? displayDate(navAsOf) : null, source: 'First Trust fund summary (Total Net Assets)' },
    shares: { outstanding: toNumber(pair('Outstanding Shares')?.value) },
    yields: {
      dividendYield,
      dividendYieldText: dividendYield === null ? null : formatPercent(dividendYield),
      dividendYieldBasis,
      dividendYieldKind: rate12 !== null
        ? `First Trust published 12-month distribution rate${ratePair?.asOf ? ` as of ${displayDate(ratePair.asOf)}` : ''}`
        : catalogRate !== null
          ? `First Trust ETF list 12-month trailing distribution rate${fund.yieldAsOf ? ` as of ${displayDate(fund.yieldAsOf)}` : ''}`
          : indicated !== null
            ? 'Indicated from the latest ordinary distribution per share x inferred payments per year / market price'
            : null,
      distributionRate: toNumber(pair('Distribution Rate')?.value),
      distributionPerShare: toNumber(pair('Most Recent Distribution', 'Distribution Amount')?.value),
      secYield,
      secYieldText: secYield === null ? null : formatPercent(secYield),
      secYieldKind: secYield === null ? null : `First Trust published 30-day SEC yield${pair('30-Day SEC Yield')?.asOf ? ` as of ${displayDate(pair('30-Day SEC Yield')?.asOf)}` : fund.yieldAsOf ? ` as of ${displayDate(fund.yieldAsOf)}` : ''}`,
      unsubsidizedSecYield: fund.unsubsidizedSecYield,
    },
    returns: {
      derivedFrom: 'First Trust published NAV performance (month-end and quarter-end; average annualized for periods of one year or more)',
      monthEnd,
      quarterEnd,
    },
    distributions: {
      frequency: distSummary.frequency,
      latestAmount: distSummary.latest,
      latestExDate: distSummary.exDate,
      headers: DISTRIBUTION_HEADERS,
      rows: distRows,
      source: distributionSource,
    },
    holdings: hManifest,
    history: yManifest,
    holdingsCount: hManifest.totalRows,
    historyCount: yManifest.totalRows,
    distributionCount: distRows.length,
    netAssets: aum,
    dividendYield,
    secYield,
  };
  await writeIfChanged(new URL(`funds/${fund.ticker}/meta.json`, API_ROOT), meta);
  await pruneStalePages(fund.ticker, 'holdings', hManifest.pages);
  await pruneStalePages(fund.ticker, 'history', yManifest.pages);
  return { meta, officialHistoryCount, yahooHistoryCount };
}

export async function mapWithConcurrency<T>(items: T[], concurrency: number, work: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      await work(items[index], index);
    }
  });
  await Promise.all(workers);
}

/** One run's SEC state: the two SEC ticker tables (each loaded once), the registrant CIKs found by full-text search and the N-PORT reader cache. */
let secState: { funds: Promise<Map<string, NportSeriesRef>> | null; names: Promise<Map<string, string>> | null; ciks: Map<string, string | null>; reader: Map<string, unknown> } = { funds: null, names: null, ciks: new Map(), reader: new Map() };

/** A fresh SEC state for a run (main and tests). */
export function resetSecState(): void {
  secState = { funds: null, names: null, ciks: new Map(), reader: new Map() };
}

/** SEC's ticker -> registrant CIK + series id table, loaded once per run (a failed load is asked again by the next fund). */
function loadFundTickerTable(config: UpdaterConfig): Promise<Map<string, NportSeriesRef>> {
  if (!secState.funds) {
    const loading = fetchJson(SEC_FUND_TICKERS_URL, '[ edgar    ] fund ticker table', secHeaders(config), config).then((payload) => parseSecFundTickers(payload));
    secState.funds = loading;
    loading.catch(() => { if (secState.funds === loading) secState.funds = null; });
  }
  return secState.funds;
}

/** SEC's company name -> ticker table for the N-PORT rows, loaded once per run. */
function loadCompanyNames(config: UpdaterConfig): Promise<Map<string, string>> {
  if (!secState.names) {
    const loading = fetchJson(SEC_COMPANY_TICKERS_URL, '[ edgar    ] company ticker table', secHeaders(config), config).then((payload) => parseSecCompanyNames(payload));
    secState.names = loading;
    loading.catch(() => { if (secState.names === loading) secState.names = null; });
  }
  return secState.names;
}

/** Nasdaq Trader symbol directories for the N-PORT rows (shared nport-reader `readUsListings`), loaded once per run: a row with a
 * foreign ISIN keeps a ticker only for the company's own U.S. listing in U.S. dollars (Linde, NXP, IMAX). null when either failed. */
let usListings: Promise<Map<string, string> | null> | null = null;
function loadUsListings(getText: (url: string, label: string) => Promise<string>): Promise<Map<string, string> | null> {
  if (!usListings) usListings = readUsListings(getText);
  return usListings;
}

// The registrant CIK of a fund missing from SEC's fund ticker table (a new launch): the seed may pin it, otherwise the
// EDGAR full-text search finds the trust whose N-PORT-P filings name the ticker (cached per run).
async function resolveRegistrantCik(fund: CatalogFund, config: UpdaterConfig): Promise<string | null> {
  if (secState.ciks.has(fund.ticker)) return secState.ciks.get(fund.ticker) ?? null;
  let cik: string | null = fund.trustCik || null;
  if (!cik) {
    try {
      const payload = await fetchJson(eftsSearchUrl(fund.ticker), `[ edgar    ] search ${fund.ticker}`, secHeaders(config), config);
      cik = pickEftsCik(payload, fund.name);
    } catch (error) {
      outputNote(`[ edgar    ] search ${fund.ticker}: ${errorMessage(error)}`);
    }
  }
  secState.ciks.set(fund.ticker, cik);
  return cik;
}
// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export type RunSummary = { updated: number; kept: number; failures: number; stoppedAtDeadline: boolean; newFunds: { published: string[]; pending: string[] } };

let softDeadlineMs = 25 * 60_000;

/** The run stops taking new funds after this many ms (the workflow limit is 30 min) and still writes the index. */
export function configureSoftDeadline(ms: number): void {
  softDeadlineMs = ms;
}

export async function main(env: Record<string, string | undefined> = process.env): Promise<RunSummary> {
  const startedAt = Date.now();
  summaryCache.clear();
  resetSecState();
  const controls = await runtimeControls(env);
  installSystemCa(controls.USE_SYSTEM_CA ?? 'auto');
  if (controls.VERBOSE !== undefined && env === process.env) process.env.VERBOSE = controls.VERBOSE;
  const config = readConfig(controls);
  configureRequestLanes(config.concurrency, config.requestSleep);

  outputPrintConfig('First Trust', config);

  // 1) Catalog discovery: official ETF list (+ NAV performance view), previous index.
  const previousIndex = await readPreviousIndex();
  let catalog: Fund[] = [];
  let catalogSource = 'previous api/firsttrust/index.json';
  let live = false;
  try {
    catalog = parseCatalogHtml(await fetchText(FIRSTTRUST_ETF_LIST, '[ catalog  ] ETF list', firstTrustHeaders(), config));
    if (!catalog.length) throw new Error('official ETF list contained no funds');
    live = true;
    catalogSource = 'ftportfolios.com official ETF list';
  } catch (error) {
    console.warn(`[ catalog  ] ${errorMessage(error)} — falling back to the published feed`);
  }
  if (live) {
    try {
      const performance = parsePerformanceNavHtml(await fetchText(FIRSTTRUST_PERFORMANCE_LIST, '[ catalog  ] NAV performance view', firstTrustHeaders(), config));
      for (const fund of catalog) applyCatalogPerformance(fund, performance.get(fund.ticker));
      catalogSource += ` + NAV performance view (${performance.size} funds)`;
    } catch (error) {
      console.warn(`[ catalog  ] NAV performance view: ${errorMessage(error)} — TER and returns come from the fund pages`);
    }
  }
  // The live catalog (null when only the published feed is known): a catalog-only row it no longer lists (an old mistyped
  // TICKERS entry, a fund withdrawn before launch) is dropped, never kept or retried; published funds always stay.
  const liveTickers = live ? catalog.map((fund) => fund.ticker) : null;
  const previousRows = withoutStalePlaceholders(Array.from(previousIndex.values()), liveTickers);
  if (live) {
    const known = new Set(catalog.map((fund) => fund.ticker));
    for (const item of previousRows) if (!known.has(String(item.ticker))) catalog.push(cachedFundFromIndex(item));
    catalog.sort((a, b) => a.ticker.localeCompare(b.ticker));
  } else {
    catalog = previousRows.map(cachedFundFromIndex).filter((fund) => Boolean(fund.ticker));
  }
  if (!catalog.length) throw new Error('No current or previously published First Trust catalog is available');
  for (const fund of catalog) mergePrevious(fund, previousIndex.get(fund.ticker));
  console.log(`[ catalog  ] ${catalog.length} First Trust ETFs (${catalogSource})`);

  // 2) Filters: TICKERS allowlist, then the data filters on catalog values.
  // Q27: a TICKERS entry outside the live catalog and the published funds stops the run before any fund request.
  const requested = new Set(config.tickers);
  assertKnownTickers(config.tickers, knownTickers(liveTickers, Array.from(previousIndex.values())), 'the First Trust catalog or published feed');
  // A closed fund leaves the run here, before any per-fund request (the deferred summaries below) and before the MAX_FETCHES budget.
  const candidates = withoutClosedFunds(requested.size ? catalog.filter((fund) => requested.has(fund.ticker)) : catalog, (fund) => fund.ticker, CLOSED_FUNDS);
  const deferred = live ? candidates.filter((fund) => needsSummaryForFilters(fund, config)) : [];
  await mapWithConcurrency(deferred, config.concurrency, async (fund) => {
    try {
      applySummary(fund, await loadSummary(fund.ticker, config));
    } catch (error) {
      outputNote(`[ product  ] ${fund.ticker} summary: ${errorMessage(error)}`);
    }
  });
  const universe = candidates.filter((fund) => fundPasses(fund, config));
  outputPrintFilter(universe.length, catalog.length, deferred.length > 0);
  if (requested.size) {
    const filtered = config.tickers.filter((ticker) => !universe.some((fund) => fund.ticker === ticker) && !closedFund(CLOSED_FUNDS, ticker));
    if (filtered.length) throw new Error(`Requested ticker(s) were excluded by configured filters: ${filtered.join(', ')}`);
  }

  // 3) Bounded, resumable batch run (JPMorgan/iShares cursor semantics).
  // K: a TICKERS run never reads, writes or deletes the cursor; the cursor is scoped to the (already filtered) universe and wraps around.
  const useCursor = requested.size === 0;
  const state = useCursor ? await readUpdateState() : null;
  // A bounded run walks the alphabetical cursor; an unbounded run goes stalest first, so a run cut short by
  // the soft deadline leaves the freshest funds for last and the next run starts with the skipped ones.
  const cursor = config.maxFetches > 0 ? state?.cursor || null : null;
  const cursorIndex = cursor ? universe.findIndex((fund) => fund.ticker === cursor) : -1;
  const ordered = config.maxFetches > 0
    ? (cursorIndex >= 0 ? universe.slice(cursorIndex + 1).concat(universe.slice(0, cursorIndex + 1)) : universe.slice())
    : stalestFirst(universe, previousIndex);
  const queue = ordered.slice();
  const queued = queue.length;
  const results = new Map<string, JsonRecord>();
  let processed = 0;
  let lastProcessedTicker: string | null = cursor;
  let failures = 0;
  let stoppedAtDeadline = false;

  const output = outputCreateReporter(API_ROOT, config.maxFetches > 0 ? Math.min(config.maxFetches, ordered.length) : ordered.length);
  async function worker(): Promise<void> {
    for (;;) {
      if (!queue.length) return;
      if (Date.now() - startedAt >= softDeadlineMs) {
        stoppedAtDeadline = true;
        return;
      }
      const fund = queue.shift()!;
      if (config.maxFetches > 0 && processed >= config.maxFetches) return;
      processed += 1;
      const before = await output.before(fund.ticker);
      try {
        const result = await createMeta(fund, config);
        results.set(fund.ticker, indexEntryFromMeta(fund, result.meta));
        lastProcessedTicker = fund.ticker;
        await output.result(fund.ticker, before, undefined, undefined, {
          officialHistoryCount: result.officialHistoryCount,
          yahooHistoryCount: result.yahooHistoryCount,
        });
      } catch (error) {
        failures += 1;
        await output.result(fund.ticker, before, 'failed', errorMessage(error));
      }
      if (config.maxFetches > 0 && processed >= config.maxFetches) {
        console.log(`[ cursor   ] batch of ${config.maxFetches} reached — rerun to continue after ${lastProcessedTicker}`);
        return;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, config.concurrency) }, () => worker()));

  // 4) Index: fresh rows, previously published rows, rows rebuilt from published meta.json, catalog-only rows (dataFile null) for never-fetched funds.
  const published = await publishedFundTickers();
  let keptFromPrevious = 0;
  const funds: JsonRecord[] = [];
  const listed = new Set<string>();
  for (const fund of catalog) {
    const fresh = results.get(fund.ticker);
    const previous = previousIndex.get(fund.ticker);
    listed.add(fund.ticker);
    if (fresh) funds.push(fresh);
    else if (previous && (published.has(fund.ticker) || !live)) {
      const keptMeta = published.has(fund.ticker) ? await readJson(new URL(`funds/${fund.ticker}/meta.json`, API_ROOT)) : null;
      funds.push(normalizePreviousRow(previous, published.has(fund.ticker), isRecord(keptMeta) ? keptMeta : undefined));
      keptFromPrevious += 1;
    } else if (published.has(fund.ticker)) {
      const meta = await readJson(new URL(`funds/${fund.ticker}/meta.json`, API_ROOT));
      funds.push(isRecord(meta) ? indexEntryFromMeta(fund, meta) : catalogOnlyEntry(fund));
      keptFromPrevious += 1;
    } else funds.push(catalogOnlyEntry(fund));
  }
  // Every fund that has a funds/<T>/meta.json stays listed, even when the live catalog and the previous index lost it.
  for (const ticker of [...published].sort()) {
    if (listed.has(ticker)) continue;
    const meta = await readJson(new URL(`funds/${ticker}/meta.json`, API_ROOT));
    if (!isRecord(meta)) continue;
    funds.push(indexEntryFromMeta(emptyFund(ticker, String(meta.name ?? ''), String(meta.category ?? '')), meta));
    keptFromPrevious += 1;
  }
  funds.sort((a, b) => String(a.ticker).localeCompare(String(b.ticker)));
  // the 52-week range of every row from its published history pages (shared range-52w block)
  const indexRows = await withRange52w(API_ROOT, markClosedFunds(funds, CLOSED_FUNDS));
  const counts = {
    funds: funds.length,
    holdings: funds.reduce((sum, fund) => sum + (numberOrNull(fund.holdings) || 0), 0),
    history: funds.reduce((sum, fund) => sum + (numberOrNull(fund.history) || 0), 0),
  };
  await writeIfChanged(INDEX_FILE, {
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    source: {
      provider: 'First Trust ETFs (First Trust Portfolios L.P. / First Trust Advisors L.P.)',
      market: 'us',
      site: FIRSTTRUST_SITE,
      catalog: FIRSTTRUST_ETF_LIST,
      catalogPerformance: FIRSTTRUST_PERFORMANCE_LIST,
      issuerHome: FIRSTTRUST_HOME,
      fundPages: `${FIRSTTRUST_ETF_PATH}/{EtfSummary|EtfHoldings|EtfPriceHistory|EtfDividHistory}.aspx?Ticker={TICKER}`,
      history: 'First Trust official daily NAV / market price history (Excel export); Yahoo Finance chart as fallback',
      holdings: `First Trust official holdings pages; SEC EDGAR Form N-PORT-P (${SEC_TRUSTS}) as fallback`,
    },
    counts,
    funds: indexRows,
  });
  // Q28: a fund is announced on its first successful publish (a catalog-only row is not published), new catalog-only rows as pending
  const newFunds = newFundsReport(Array.from(previousIndex.values()), indexRows);
  const newFundLines = newFundsLines(newFunds);
  for (const line of newFundLines) console.log(line);

  // Only a bounded run owns the cursor and resumes after the last processed fund; unbounded runs reset it (their order is stalest first).
  if (useCursor) await writeUpdateState(config.maxFetches > 0 ? lastProcessedTicker : null);
  const deadlineText = stoppedAtDeadline ? `soft deadline of ${Math.round(softDeadlineMs / 1000)} s reached: ${deadlineSummary(processed, queued, queue, previousIndex)}` : '';
  if (stoppedAtDeadline) console.log(`[ deadline ] ${deadlineText}; the next run starts with them`);

  console.log(output.summary(startedAt));
  console.log(outputCounts(counts.funds, counts.holdings, counts.history));
  console.log(`[ cursor   ] ${useCursor ? (config.maxFetches > 0 && lastProcessedTicker ? `next run continues after ${lastProcessedTicker}` : 'unbounded run (cursor reset)') : 'TICKERS run: cursor untouched'}`);

  if (env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      env.GITHUB_STEP_SUMMARY,
      `### First Trust data update\n\n- updated: ${results.size}\n- kept from previous runs: ${keptFromPrevious}\n- failed: ${failures}\n${stoppedAtDeadline ? `- ${deadlineText}\n` : ''}- counts: ${counts.funds} funds / ${counts.holdings.toLocaleString('en-US')} holdings rows / ${counts.history.toLocaleString('en-US')} history rows\n`,
      'utf8',
    );
    if (newFundLines.length) await appendFile(env.GITHUB_STEP_SUMMARY, `### NEW FUNDS\n\n${newFundLines.join('\n')}\n`, 'utf8');
  }
  return { updated: results.size, kept: keptFromPrevious, failures, stoppedAtDeadline, newFunds };
}

// Exported deterministic normalization for tests (mirrors the app's Frequency display rule).
export function formatFrequencyPlaceholder(value: unknown): string {
  const raw = String(value ?? '').trim();
  const normalized = raw.toLowerCase().replace(/[‐‑‒–—]/g, '-').replace(/\s+/g, ' ');
  if (!normalized || normalized === '-') return '00 - None';
  if (normalized === 'monthly') return '01 - Monthly';
  if (normalized === 'quarterly') return '04 - Quarterly';
  if (normalized === 'semi-annual' || normalized === 'semi-annually' || normalized === 'semiannual') return '06 - Semi-annually';
  if (normalized === 'annual' || normalized === 'annually') return '12 - Annually';
  if (normalized === 'none') return '00 - None';
  if (normalized === 'unknown') return '00 - Unknown';
  if (normalized === 'irregular') return '99 - Irregular';
  return raw;
}

// ---------------------------------------------------------------------------
// Entry point (kept at the end: main() relies on the let bindings above)
// ---------------------------------------------------------------------------

if ((import.meta as { main?: boolean }).main) {
  if (process.argv.includes('-h') || process.argv.includes('--help')) {
    console.log(USAGE.trim());
  } else {
    await main()
      .then((summary) => {
        // Every fund failed: the job must not look green.
        if (summary.failures > 0 && summary.updated === 0) process.exitCode = 1;
      })
      .catch((error) => {
        console.error(error instanceof Error ? error.stack : String(error));
        process.exitCode = 1;
      });
  }
}

// <holdings-guard> shared block of .claude/tools/etfs/etf-std/holdings-guard.block.ts, applied by apply-holdings-guard.ts: never edit it in one repo
/**
 * Sanity check of a fund's new holdings before they replace the published ones. Returns why they must be rejected
 * (the caller then keeps the fund's previous state and reports it as failed), or null when they may be written.
 * An empty sheet passes only when nothing was published before. Otherwise a Name and a weight column (Weight,
 * Weight (%) or Market Weight) are required, >= 80% of the rows carry a numeric weight, the weights add up to
 * 50..150 and the sheet keeps >= 50% of the previously published rows. `relax` switches off the checks a fund
 * legitimately fails: 'numeric' and 'sum' (geared, inverse, futures, look-through, top-N lists) and 'count'. No relax lets
 * a sheet without a single numeric weight replace a published sheet that had numeric weights (`previousWeights`: how many
 * rows of the published sheet carry a numeric weight, see holdingsWeightCount; open-items etfs Q24).
 * Rows are arrays in header order or objects keyed by the header text. A fund in the brand's CLOSED_FUNDS never reaches the guard.
 */
export function holdingsGuard(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>, previousRows: number | null | undefined, relax: ReadonlyArray<string> = [], previousWeights: number | null = null): string | null {
  const previous = Number(previousRows) > 0 ? Number(previousRows) : 0;
  if (!rows.length) return previous ? `no holdings rows (${previous} published)` : null;
  const names = headers.map((header) => String(header).trim().toLowerCase());
  const nameAt = names.indexOf('name');
  let weightAt = names.indexOf('weight');
  if (weightAt < 0) weightAt = names.indexOf('weight (%)');
  if (weightAt < 0) weightAt = names.indexOf('market weight');
  if (nameAt < 0 || weightAt < 0) return `no ${nameAt < 0 ? 'Name' : 'weight'} column (headers: ${headers.join(', ') || 'none'})`;
  const weights = holdingsGuardWeights(headers, rows, weightAt);
  const numeric = weights.count;
  const sum = weights.sum;
  if (numeric === 0 && Number(previousWeights) > 0) return `no row has a numeric weight, the published sheet had ${Number(previousWeights)}`;
  if (relax.indexOf('numeric') < 0 && numeric < rows.length * 0.8) return `only ${numeric} of ${rows.length} rows have a numeric weight`;
  if (relax.indexOf('sum') < 0 && (sum < 50 || sum > 150)) return `weights add up to ${sum.toFixed(2)}, outside 50..150`;
  if (relax.indexOf('count') < 0 && previous && rows.length < previous * 0.5) return `${rows.length} rows, less than half of the ${previous} published`;
  return null;
}

/** How many rows carry a numeric weight (Weight, Weight (%) or Market Weight column), 0 without such a column: pass it for the published sheet as holdingsGuard's previousWeights. */
export function holdingsWeightCount(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>): number {
  const names = headers.map((header) => String(header).trim().toLowerCase());
  let weightAt = names.indexOf('weight');
  if (weightAt < 0) weightAt = names.indexOf('weight (%)');
  if (weightAt < 0) weightAt = names.indexOf('market weight');
  return weightAt < 0 ? 0 : holdingsGuardWeights(headers, rows, weightAt).count;
}

/** Count and sum of the numeric weights in column weightAt; rows are arrays in header order or objects keyed by the header text. */
function holdingsGuardWeights(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>, weightAt: number): { count: number; sum: number } {
  let count = 0;
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    const row: any = rows[i];
    const weight = holdingsGuardNumber(Array.isArray(row) ? row[weightAt] : row && typeof row === 'object' ? row[headers[weightAt]] : undefined);
    if (weight !== null) {
      count++;
      sum += weight;
    }
  }
  return { count, sum };
}

/** A weight cell as a number: %, $, commas and spaces are ignored, (x) is negative; null when it is no plain number (a zero-width character inside counts as broken). */
function holdingsGuardNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let text = String(value === null || value === undefined ? '' : value).replace(/[ \t ,%$]/g, '').replace(/−/g, '-');
  const negative = /^\(.*\)$/.test(text);
  if (negative) text = text.slice(1, -1);
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return null;
  return negative ? -Number(text) : Number(text);
}

/** A fund its issuer closed (liquidated, delisted or merged away), confirmed from an official source: an SEC filing or the issuer's notice. */
export type ClosedFund = { ticker: string; closed: string; source: string };

/**
 * The brand's CLOSED_FUNDS entry for a ticker, or null. A closed fund is never fetched, never guarded and never reported failed: it keeps
 * its last published data and its index row carries `status: 'closed'`, `closedDate` and `closedSource`. A malformed entry throws, so a
 * typo (no ISO date, no https source) never ships.
 */
export function closedFund(list: ReadonlyArray<ClosedFund>, ticker: unknown): ClosedFund | null {
  const wanted = String(ticker === null || ticker === undefined ? '' : ticker).trim().toUpperCase();
  let found: ClosedFund | null = null;
  for (let i = 0; i < list.length; i++) {
    const fund = list[i];
    if (!/^[A-Z0-9][A-Z0-9.-]{0,9}$/.test(fund.ticker) || !/^\d{4}-\d{2}-\d{2}$/.test(fund.closed) || !/^https:\/\/\S+$/.test(fund.source)) throw new Error(`CLOSED_FUNDS: ${fund.ticker} needs an upper-case ticker, an ISO closing date and an https source`);
    if (fund.ticker === wanted) found = fund;
  }
  return found;
}

/** The index rows with every closed fund marked (`status: 'closed'`, `closedDate`, `closedSource`); other rows are returned as they are. */
export function markClosedFunds<T extends object>(rows: ReadonlyArray<T>, list: ReadonlyArray<ClosedFund>): T[] {
  return rows.map((row) => {
    const fund = closedFund(list, (row as { ticker?: unknown }).ticker);
    return fund ? ({ ...row, status: 'closed', closedDate: fund.closed, closedSource: fund.source } as T) : row;
  });
}

/** A run's queue without the closed funds, which are named once in the log: they are neither fetched nor counted as failed. */
export function withoutClosedFunds<T>(queue: ReadonlyArray<T>, tickerOf: (item: T) => string, list: ReadonlyArray<ClosedFund>): T[] {
  const closed: string[] = [];
  const open: T[] = [];
  for (let i = 0; i < queue.length; i++) {
    if (closedFund(list, tickerOf(queue[i]))) closed.push(tickerOf(queue[i]));
    else open.push(queue[i]);
  }
  if (closed.length) console.log(`[ closed   ] ${closed.join(', ')}: closed by the issuer, published data kept`);
  return open;
}
// </holdings-guard>

// <nport-reader> shared block of .claude/tools/etfs/etf-std/nport-reader.block.ts, applied by apply-block.ts: never edit it in one repo
/**
 * SEC EDGAR Form N-PORT-P holdings reader (open-items etfs ETF-H2), one copy for every brand. Pure functions plus one reader
 * that takes the brand's own `getText(url, label)` (its SEC User-Agent, timeout, retries and pacing). Rules it enforces:
 * - identifiers come from the position itself: `<cusip>` text (or a `value` attribute), `<isin value>`, `<ticker value>`,
 *   `<other value>`; a derivative's reference instrument (inside `<derivativeInfo>`) never lends its identifiers to the position
 * - CUSIP `000000000` and `N/A` are missing; a missing weight or value is null (an empty cell), never 0
 * - a ticker only for a common-stock row (assetCat EC, not a CVR, right, warrant or escrow line) traded in USD with a U.S.
 *   ISIN or none, or with a foreign ISIN when the Nasdaq Trader directories list that ticker for the same company (a U.S.
 *   listing such as Linde, NXP, IMAX); renamed issuers through `nportRenamedIssuers`; an abbreviated or reordered name the
 *   exact key misses through a looser key that must name one company (`nportLooseKey`, Q35: `Lowe's Cos` = `LOWES COMPANIES`,
 *   `SCHWAB CHARLES CORP`); never one ticker on two different securities (`nportTickers`)
 * - identity: the filing must name the fund's own series id, or, with no series id known, the fund's name (`nportIdentity`)
 * - freshness: the report period must be strictly newer than the published holdings (`nportIsFresh`)
 * - filings come newest report period first from the registrant's own archive folder, never from the filer agent's CIK
 *   (the accession number prefix)
 */
export type NportPosition = {
  name: string;
  title: string;
  lei: string;
  cusip: string;
  isin: string;
  ticker: string;
  other: string;
  otherDesc: string;
  balance: number | null;
  units: string;
  currency: string;
  /** valUSD, null when the filing has none */
  value: number | null;
  /** pctVal: percent of net assets (0.5 = 0.5%), null when the filing has none */
  weight: number | null;
  payoff: string;
  assetCat: string;
  issuerCat: string;
  country: string;
  /** derivCat of the position's derivativeInfo (FUT, FWD, SWP, OPT, ...), empty for a security */
  derivative: string;
  /** debtSec annualizedRt and maturityDt (ISO), null and '' for a non-debt row */
  coupon: number | null;
  maturity: string;
};

export type NportFiling = {
  seriesId: string;
  seriesName: string;
  regName: string;
  regCik: string;
  /** report period end (genInfo repPdDate) as ISO, '' when missing */
  repPdDate: string;
  netAssets: number | null;
  totalAssets: number | null;
  positions: NportPosition[];
};

export type NportCandidate = { accession: string; filed: string; period: string; cik: string };
export type NportSeriesRef = { cik: string; seriesId: string; classId: string };

/** XML text: entities decoded, tags dropped, whitespace collapsed. */
function nportText(raw: string): string {
  return String(raw)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_m: string, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m: string, dec: string) => String.fromCharCode(Number(dec)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/[\s ]+/g, ' ')
    .trim();
}

/** Text of the first `<tag>` (any namespace prefix) in `xml`, '' when absent. */
function nportTag(xml: string, tag: string): string {
  const match = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?${tag}>`, 'i').exec(xml);
  return match ? nportText(match[1]) : '';
}

/** The `attribute` of the first `<tag ...>` (any namespace prefix) in `xml`, '' when absent. */
function nportAttr(xml: string, tag: string, attribute: string): string {
  const match = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tag}\\s[^>]*?\\b${attribute}\\s*=\\s*"([^"]*)"`, 'i').exec(xml);
  return match ? nportText(match[1]) : '';
}

/** A plain decimal or exponent number, null for an empty, N/A or broken cell. */
function nportNumber(raw: string): number | null {
  const text = String(raw).replace(/[\s,]/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** An identifier code, '' for N/A, NONE and all zeros (CUSIP 000000000 means "no CUSIP"). */
function nportCode(raw: string): string {
  const text = String(raw).trim().toUpperCase();
  return !text || /^(N\/?A|NONE|-+|0+)$/.test(text) ? '' : text;
}

/** ISO date of an N-PORT date (YYYY-MM-DD, possibly with a time), '' otherwise. */
function nportIso(raw: unknown): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw === null || raw === undefined ? '' : raw).trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

/** One N-PORT-P primary_doc.xml (or the full submission .txt that embeds it) as series facts and positions. */
export function parseNportFiling(xml: string): NportFiling {
  const text = String(xml === null || xml === undefined ? '' : xml);
  const genInfo = /<(?:[A-Za-z0-9_.-]+:)?genInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?genInfo>/i.exec(text);
  const fundInfo = /<(?:[A-Za-z0-9_.-]+:)?fundInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?fundInfo>/i.exec(text);
  const gen = genInfo ? genInfo[1] : '';
  const fund = fundInfo ? fundInfo[1].replace(/<(?:[A-Za-z0-9_.-]+:)?returnInfo\b[\s\S]*?<\/(?:[A-Za-z0-9_.-]+:)?returnInfo>/gi, ' ') : '';
  const positions: NportPosition[] = [];
  const blocks = /<(?:[A-Za-z0-9_.-]+:)?invstOrSec\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?invstOrSec>/gi;
  let block: RegExpExecArray | null;
  while ((block = blocks.exec(text)) !== null) {
    const raw = block[1];
    const derivativeInfo = /<(?:[A-Za-z0-9_.-]+:)?derivativeInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?derivativeInfo>/i.exec(raw);
    // The reference instrument of a derivative (SPY for a SPY option, a bond for a CDS) is another security: drop it first.
    const own = raw.replace(/<(?:[A-Za-z0-9_.-]+:)?derivativeInfo\b[^>]*>[\s\S]*?<\/(?:[A-Za-z0-9_.-]+:)?derivativeInfo>/gi, ' ');
    const identifiers = /<(?:[A-Za-z0-9_.-]+:)?identifiers\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?identifiers>/i.exec(own);
    const ids = identifiers ? identifiers[1] : '';
    const debt = /<(?:[A-Za-z0-9_.-]+:)?debtSec\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?debtSec>/i.exec(own);
    const name = nportTag(own, 'name');
    positions.push({
      name: name && !/^N\/?A$/i.test(name) ? name : nportTag(own, 'title'),
      title: nportTag(own, 'title'),
      lei: nportCode(nportTag(own, 'lei')),
      cusip: nportCode(nportTag(own, 'cusip') || nportAttr(ids, 'cusip', 'value')),
      isin: nportCode(nportAttr(ids, 'isin', 'value')),
      ticker: nportCode(nportAttr(ids, 'ticker', 'value')),
      other: nportCode(nportAttr(ids, 'other', 'value')),
      otherDesc: nportAttr(ids, 'other', 'otherDesc'),
      balance: nportNumber(nportTag(own, 'balance')),
      units: nportTag(own, 'units'),
      currency: (nportTag(own, 'curCd') || nportAttr(own, 'currencyConditional', 'curCd')).toUpperCase(),
      value: nportNumber(nportTag(own, 'valUSD')),
      weight: nportNumber(nportTag(own, 'pctVal')),
      payoff: nportTag(own, 'payoffProfile'),
      assetCat: (nportTag(own, 'assetCat') || nportAttr(own, 'assetConditional', 'assetCat')).toUpperCase(),
      issuerCat: (nportTag(own, 'issuerCat') || nportAttr(own, 'issuerConditional', 'issuerCat')).toUpperCase(),
      country: nportTag(own, 'invCountry').toUpperCase(),
      derivative: derivativeInfo ? (/\bderivCat\s*=\s*"([^"]*)"/i.exec(derivativeInfo[1]) || ['', 'OTHER'])[1].toUpperCase() : '',
      coupon: debt ? nportNumber(nportTag(debt[1], 'annualizedRt')) : null,
      maturity: debt ? nportIso(nportTag(debt[1], 'maturityDt')) : '',
    });
  }
  return {
    seriesId: nportTag(gen, 'seriesId').toUpperCase(),
    seriesName: nportTag(gen, 'seriesName'),
    regName: nportTag(gen, 'regName'),
    regCik: nportTag(gen, 'regCik').replace(/\D/g, ''),
    repPdDate: nportIso(nportTag(gen, 'repPdDate')),
    netAssets: nportNumber(nportTag(fund, 'netAssets')),
    totalAssets: nportNumber(nportTag(fund, 'totAssets')),
    positions,
  };
}

/**
 * A number as sheet text: '' for null, no exponent, at most `digits` decimals (trailing zeros dropped), and no binary float
 * artifact: `115797518.01` stays `115797518.01`, not the `115797518.01000001` of `toFixed(8)`.
 */
export function nportCell(value: number | null, digits = 8): string {
  if (value === null || !Number.isFinite(value)) return '';
  const fixed = value.toFixed(digits);
  // the shortest text of the rounded number; toFixed only where that text would be an exponent (very small or large numbers)
  const shortest = String(Number(fixed));
  if (!/e/i.test(shortest)) return shortest;
  return fixed.indexOf('.') < 0 ? fixed : fixed.replace(/0+$/, '').replace(/\.$/, '');
}

/** The position's own identifier for a sheet: CUSIP, else ISIN, else the "other" code (a Bloomberg or internal id), else ''. */
export function nportIdentifier(position: NportPosition): string {
  return position.cusip || position.isin || position.other;
}

/**
 * A company name as a lookup key: upper case, punctuation and legal suffixes dropped, `CLASS A` -> `CL A`. Initials are one
 * word whether written with dots, spaces or a slash (`N.V.` = `N V` = `NV`, `C.H. ROBINSON` = `C H ROBINSON`, `A/S` = `A S`,
 * `S.A.B. de C.V.` = `SAB DE CV`), `PUBLIC LIMITED COMPANY` is `plc`, and a leading `US` stays (`U.S. BANCORP` is not
 * `BANCORP, INC.`), so both spellings of one issuer give one key.
 */
export function nportNameKey(value: unknown): string {
  // EDGAR adds a state or qualifier suffix to company titles ("COSTCO WHOLESALE CORP /NEW", "BANK OF AMERICA CORP /DE/",
  // "US BANCORP \DE\", "ACUITY INC. (DE)"): drop a trailing one
  const raw = String(value === null || value === undefined ? '' : value).replace(/(?:\s*(?:[\/\\]\s*[A-Za-z]{2,3}\s*[\/\\]?|\(\s*[A-Za-z]{2,3}\s*\)))+\s*$/, '');
  let text = nportText(raw).toUpperCase().replace(/['’]/g, '').replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, ' ').trim();
  text = text.replace(/\bCLASS\s+([A-Z])\b/g, 'CL $1').replace(/\bCL\s+([A-Z])\b/g, 'CL $1');
  // a run of single letters is one word, never the class letter after CL
  const words: string[] = [];
  let joining = false;
  text.split(' ').forEach((word) => {
    const letter = /^[A-Z]$/.test(word);
    if (letter && joining) words[words.length - 1] += word;
    else words.push(word);
    joining = letter && (joining || words[words.length - 2] !== 'CL');
  });
  text = words.join(' ').replace(/\bPUBLIC (?:(?:LIMITED|LTD)(?: (?:COMP[A-Z]*|CO))?|(?:COMPANY|CO) (?:LIMITED|LTD))\b/g, 'PLC').replace(/\b(?:S DE RL )?DE CV\b/g, ' ');
  const share = /\bCL [A-Z]\b/.exec(text);
  text = text.replace(/\b(THE|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|SA|SAB|NV|AG|SE|SPA|AS|ASA|ORDINARY|COMMON|STOCK|SHS|SHARES|ADR|DEPOSITARY|RECEIPT|USD|US|REG|REGISTERED)\b/g, (word: string, _name: string, at: number) => (word === 'US' && at === 0 ? word : ' ')).replace(/\s+/g, ' ').trim();
  if (share && !/\bCL [A-Z]\b/.test(text)) text = `${text} ${share[0]}`;
  return text;
}

/**
 * Abbreviated words of issuer names (open-items etfs Q35) -> one spelling, each seen in N-PORT-P filings of the brands against
 * the SEC company_tickers.json title of the same CUSIP issuer (2026-10-26): `LOWES COS` / `LOWES COMPANIES`, `AMERIPRISE FINL`,
 * `VICI PPTYS`, `TAIWAN SEMICONDUCTOR MFG`, `ZIONS BANCORP NA` / `ZIONS BANCORPORATION NATIONAL ASSOCIATION`. '' drops the word.
 */
function nportLooseWords(): Record<string, string> {
  return {
    COS: '', COMPANIES: '', AND: '', OF: '', NA: '', NATIONAL_ASSOCIATION: '', INCORPORATION: '', REIT: '',
    BANCORPORATION: 'BANCORP', FINL: 'FINANCIAL', PPTYS: 'PROPERTIES', PPTY: 'PROPERTY', MFG: 'MANUFACTURING', GRP: 'GROUP',
    HLDGS: 'HOLDINGS', HLDG: 'HOLDING', INTL: 'INTERNATIONAL', SVCS: 'SERVICES', TECH: 'TECHNOLOGIES', TECHNOLOGY: 'TECHNOLOGIES',
    SYS: 'SYSTEMS', NATL: 'NATIONAL', RES: 'RESOURCES', RLTY: 'REALTY', INDS: 'INDUSTRIES', INS: 'INSURANCE', BROS: 'BROTHERS', SVGS: 'SAVINGS',
  };
}

/**
 * The second, looser company key (open-items etfs Q35), used only for a row the exact key (`nportNameKey`) left without a
 * ticker: a Bloomberg location or article after a slash dropped (`Charles Schwab Corp/The`, `Energy Fuels Inc/canada`; never a
 * one-word start like `RE/MAX`), abbreviations read as one word (`nportLooseWords`), the share class dropped (the caller picks
 * the class) and the words sorted, so EDGAR's reordered titles meet the usual order: `SCHWAB CHARLES CORP` = `Charles Schwab
 * Corp`, `HORTON D R INC` = `DR Horton Inc`, `PRICE T ROWE GROUP INC` = `T Rowe Price Group Inc`. Several companies can share a
 * loose key: `parseSecCompanyNames` and `parseUsListings` keep such a key empty, so it never gives a ticker.
 */
export function nportLooseKey(value: unknown): string {
  let raw = String(value === null || value === undefined ? '' : value).trim();
  const slash = /^(.*\s\S*[A-Za-z]{2}[.,]?)\s*\/\s*([A-Za-z][A-Za-z .,']*)$/.exec(raw);
  if (slash) raw = slash[1];
  // a trailing EDGAR or Bloomberg qualifier after the legal form: `CHEVRON CORP NEW`, `US BANCORP DEL`, `PROGRESSIVE CORP OHIO`
  raw = raw.replace(/\b(CORP(?:ORATION)?|INC(?:ORPORATED)?|CO(?:MPANY)?|LTD|BANCORP|GROUP|GRP|TRUST|HOLDINGS?)\.?,?\s+(?:NEW|DEL|REINCORPORATION|OHIO|AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\.?$/i, '$1');
  const words = nportLooseWords();
  const key = nportNameKey(raw).replace(/ CL [A-Z]$/, '').replace(/\bNATIONAL ASSOCIATION\b/g, 'NATIONAL_ASSOCIATION');
  return key.split(' ').map((word) => (Object.prototype.hasOwnProperty.call(words, word) ? words[word] : word)).filter(Boolean).sort().join(' ');
}

/**
 * SEC company_tickers.json -> name key -> ticker (the first, largest company wins a shared key; the class-less key is added too).
 * Each loose key (`nportLooseKey`) is added as `\u0001<loose key>` -> the company's tickers, space-separated in the table's
 * order, or '' when two companies (CIKs) share it; `nportTickers` reads them for rows the exact key misses.
 */
export function parseSecCompanyNames(payload: unknown): Map<string, string> {
  const names = new Map<string, string>();
  const loose = new Map<string, { cik: string; tickers: string[] } | null>();
  const rows = payload && typeof payload === 'object' ? Object.keys(payload as object).map((key) => (payload as Record<string, unknown>)[key]) : [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as { ticker?: unknown; title?: unknown; cik_str?: unknown } | null;
    if (!row || typeof row !== 'object') continue;
    const ticker = String(row.ticker === null || row.ticker === undefined ? '' : row.ticker).trim().toUpperCase();
    const key = nportNameKey(row.title);
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker) || !key) continue;
    if (!names.has(key)) names.set(key, ticker);
    const core = key.replace(/ CL [A-Z]$/, '');
    if (core && !names.has(core)) names.set(core, ticker);
    const looseKey = nportLooseKey(row.title);
    const cik = String(row.cik_str === null || row.cik_str === undefined ? '' : row.cik_str).replace(/\D/g, '');
    if (!looseKey || !Number(cik)) continue;
    const seen = loose.get(looseKey);
    if (seen === undefined) loose.set(looseKey, { cik: String(Number(cik)), tickers: [ticker] });
    else if (seen && seen.cik === String(Number(cik))) { if (seen.tickers.indexOf(ticker) < 0) seen.tickers.push(ticker); }
    else loose.set(looseKey, null);
  }
  loose.forEach((seen, looseKey) => names.set(`\u0001${looseKey}`, seen ? seen.tickers.join(' ') : ''));
  return names;
}

/** SEC company_tickers_mf.json -> fund ticker -> registrant CIK (10 digits), series id, class id. */
export function parseSecFundTickers(payload: unknown): Map<string, NportSeriesRef> {
  const map = new Map<string, NportSeriesRef>();
  const record = (payload && typeof payload === 'object' ? payload : {}) as { fields?: unknown; data?: unknown };
  const fields = Array.isArray(record.fields) ? record.fields.map(String) : [];
  const rows = Array.isArray(record.data) ? record.data : [];
  const at = (row: unknown[], field: string): string => (fields.indexOf(field) < 0 ? '' : String(row[fields.indexOf(field)] === null || row[fields.indexOf(field)] === undefined ? '' : row[fields.indexOf(field)]).trim());
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const ticker = at(row, 'symbol').toUpperCase();
    const cik = at(row, 'cik').replace(/\D/g, '');
    const seriesId = at(row, 'seriesId').toUpperCase();
    if (!ticker || !Number(cik) || !/^S\d{9}$/.test(seriesId) || map.has(ticker)) continue;
    map.set(ticker, { cik: `0000000000${Number(cik)}`.slice(-10), seriesId, classId: at(row, 'classId').toUpperCase() });
  }
  return map;
}

/**
 * Is the row a contingent value right, a right, a warrant or an escrow line filed as equity? A placeholder CUSIP or ISIN
 * (`436CVR021`, `US009CVR0445`, `549ESC028`, `866CNT017`) says so; so does the name or title (`NOVO NORDISK A/S - CVR`,
 * `XYZ INC RIGHTS`, `... WARRANT FEB 2026`, `Luby's Inc Escrow`), except on a CUSIP with the common-stock issue number 10
 * (Schwab titles Enovix common stock 293594107 "Enovix Corp Warrants"). `CVR` as the first word is a company (CVR Energy).
 */
function nportIsRight(position: NportPosition): boolean {
  if (/^[0-9A-Z]{3}(?:CVR|ESC|CNT)/.test(position.cusip) || /^US[0-9A-Z]{3}(?:CVR|ESC|CNT)/.test(position.isin)) return true;
  if (/^[0-9A-Z]{6}10[0-9]$/.test(position.cusip)) return false;
  return [position.name, position.title].some((text) => /\S\s*\bCVRS?\b|\bCONTINGENT\b|\bRIGHTS?\b|\bRTS\b|\bWARRANTS?\b|\bWTS\b|\bESCROW\b/i.test(text));
}

/**
 * Renamed issuers (open-items etfs Q33): N-PORT filers keep an issuer's old name for months while SEC's company_tickers.json
 * titles only the new one, so the name match misses (JPMorgan JEPI's Exxon). Old name key (`nportNameKey`) -> [ticker, CUSIP
 * issuer number (the first six characters)]. Used only when the SEC table has no such key, the row's CUSIP (or U.S. ISIN) has
 * that issuer number and the SEC table still lists the ticker. Each entry was confirmed on 2026-10-26: an EC row without a
 * ticker in the N-PORT-P filings of large U.S. equity funds (VTI, SCHB, ITOT, JEPI, IWB, VB, SCHA, FNDX, FNDA, ...) whose name
 * is a former EDGAR name of the CIK that has the ticker today (data.sec.gov submissions `formerNames`, the date the old name
 * ended), the ticker the CIK's only common stock in the Nasdaq Trader directories. Add an entry only with the same evidence.
 * A function, not a const: blocks sit at the end of update-data.ts, below the top-level run, so only declarations are hoisted.
 */
export function nportRenamedIssuers(): Array<[string, string, string]> {
  return [
    ['AADI BIOSCIENCE', 'WHWK', '00032Q'], // CIK 1422142 Whitehawk Therapeutics, Inc., former EDGAR name until 2025-03-18
    ['ABACUS LIFE', 'ABX', '00258Y'], // CIK 1814287 Abacus Global Management, Inc., former EDGAR name until 2025-02-04
    ['ACUITY BRANDS', 'AYI', '00508Y'], // CIK 1144215 ACUITY INC. (DE), former EDGAR name until 2025-04-17
    ['AEROVATE THERAPEUTICS', 'JBIO', '008064'], // CIK 1798749 Jade Biosciences, Inc., former EDGAR name until 2025-04-30
    ['AILERON THERAPEUTICS', 'RNTX', '00887A'], // CIK 1420565 Rein Therapeutics, Inc., former EDGAR name until 2024-12-09
    ['ALLOVIR', 'KLRS', '482929'], // CIK 1754068 Kalaris Therapeutics, Inc., former EDGAR name until 2025-03-12
    ['AMC NETWORKS', 'AMCX', '00164V'], // CIK 1514991 AMC Global Media Inc., former EDGAR name until 2026-04-03
    ['AMMO', 'POWW', '00175J'], // CIK 1015383 Outdoor Holding Co, former EDGAR name until 2025-04-24
    ['ARDENT HEALTH PARTNERS', 'ARDT', '03980N'], // CIK 1756655 Ardent Health, Inc., former EDGAR name until 2025-05-23
    ['ARENA GROUP HOLDINGS', 'PAAI', '040044'], // CIK 894871 Paradium.AI, Inc., former EDGAR name until 2026-08-13
    ['ATEGRITY SPECIALTY HOLDINGS LLC', 'ASIC', '04681Y'], // CIK 2040491 Ategrity Specialty Insurance Co Holdings, former EDGAR name until 2025-06-11
    ['BAKKT HOLDINGS', 'BKKT', '05759B'], // CIK 1820302 Bakkt, Inc., former EDGAR name until 2026-01-20
    ['BED BATH AND BEYOND', 'NXH', '690370'], // CIK 1130713 NEIGHBORHOOD INTELLIGENCE, INC., former EDGAR name until 2026-08-14
    ['BLACKROCK FUNDING', 'BLK', '09290D'], // CIK 2012383 BlackRock, Inc., former EDGAR name until 2024-10-01
    ['BRIGHTSPHERE INVESTMENT GROUP', 'AAMI', '10948W'], // CIK 1748824 Acadian Asset Management Inc., former EDGAR name until 2024-11-14
    ['CARA THERAPEUTICS', 'TVRD', '140755'], // CIK 1346830 Tvardi Therapeutics, Inc., former EDGAR name until 2025-04-11
    ['CEA INDUSTRIES', 'BNC', '86887P'], // CIK 1482541 BNB Standard Corp, former EDGAR name until 2026-09-21
    ['CHROMADEX', 'NAGE', '171077'], // CIK 1386570 Niagen Bioscience, Inc., former EDGAR name until 2025-03-10
    ['CLEANCORE SOLUTIONS', 'ZONE', '184492'], // CIK 1956741 Zone Frontier Inc., former EDGAR name until 2026-08-20
    ['CORPORATE OFFICE PROPERTIES TRUST', 'CDP', '22002T'], // CIK 860546 COPT DEFENSE PROPERTIES, former EDGAR name until 2023-09-14
    ['CULLINAN ONCOLOGY', 'CGEM', '230031'], // CIK 1789972 Cullinan Therapeutics, Inc., former EDGAR name until 2024-04-02
    ['DIME COMMUNITY BANCSHARES', 'DCOM', '25432X'], // CIK 846617 Dime Commercial Bancshares, Inc. /NY/, former EDGAR name until 2026-05-27
    ['DOMO', 'HUCK', '257554'], // CIK 1505952 Huckleberry.ai, Inc., former EDGAR name until 2026-09-03
    ['EASTSIDE DISTILLING', 'BLNE', '277802'], // CIK 1534708 Beeline Holdings, Inc., former EDGAR name until 2025-03-11
    ['EQUITY RESIDENTIAL', 'VMRK', '29476L'], // CIK 906107 VIVMARK RESIDENTIAL, former EDGAR name until 2026-08-12
    ['EXP WORLD HOLDINGS', 'AGNT', '30212W'], // CIK 1495932 AGNT, Inc., former EDGAR name until 2026-06-01
    ['EXXON MOBIL', 'XOM', '30231G'], // holding company reorganization: XOM is CIK 2115436 ExxonMobil Holdings Corp since 2026, the old Exxon Mobil Corp is CIK 34088
    ['EYEPOINT PHARMACEUTICALS', 'EYPT', '30233G'], // CIK 1314102 EyePoint, Inc., former EDGAR name until 2025-12-08
    ['EZFILL HOLDINGS', 'NXXT', '652941'], // CIK 1817004 NEXTNRG, INC., former EDGAR name until 2025-02-14
    ['FORTUNE BRANDS HOME AND SECURITY', 'FBIN', '34964C'], // CIK 1519751 Fortune Brands Innovations, Inc., former EDGAR name until 2022-12-14
    ['FRANKLIN RESOURCES', 'BEN', '354613'], // CIK 38777 FRANKLIN TEMPLETON INC, former EDGAR name until 2026-08-14
    ['FREYR BATTERY', 'TE', '35834F'], // CIK 1992243 T1 Energy Inc., former EDGAR name until 2025-02-14
    ['GALLAGHER ARTHUR J AND', 'AJG', '363576'], // CIK 354190 Arthur J. Gallagher & Co., former EDGAR name until 2019-08-14
    ['GRAINGER WW', 'GWW', '384802'], // CIK 277135 W.W. GRAINGER, INC., former EDGAR name until 2019-10-15
    ['GRAY TELEVISION', 'GTN', '389375'], // CIK 43196 GRAY MEDIA, INC, former EDGAR name until 2025-02-24
    ['GREAT AJAX', 'RPT', '38983D'], // CIK 1614806 Rithm Property Trust Inc., former EDGAR name until 2024-11-13
    ['GREENIDGE GENERATION HOLDINGS', 'VIP', '39531G'], // CIK 1844971 Vulcan Infrastructure & Power Inc., former EDGAR name until 2026-07-09
    ['HANNON ARMSTRONG SUSTAINABLE INFRASTRUCTURE CAPITAL', 'HASI', '41068X'], // CIK 1561894 HA Sustainable Infrastructure Capital, Inc., former EDGAR name until 2024-07-02
    ['HARTFORD FINANCIAL SERVICES GROUP', 'HIG', '416515'], // CIK 874766 HARTFORD INSURANCE GROUP, INC., former EDGAR name until 2025-01-30
    ['HELIX ENERGY SOLUTIONS GROUP', 'HOS', '42330P'], // CIK 866829 HORNBECK OFFSHORE SERVICES, INC., former EDGAR name until 2026-08-31
    ['HYSTER YALE MATERIALS HANDLING', 'HY', '449172'], // CIK 1173514 HYSTER-YALE, INC., former EDGAR name until 2024-05-30
    ['IAC', 'PPLI', '44891N'], // CIK 1800227 People Inc, former EDGAR name until 2026-06-02
    ['IDENTIV', 'INVE', '45170X'], // CIK 1036044 INVE Technologies, Inc., former EDGAR name until 2026-08-25
    ['IRHYTHM TECHNOLOGIES', 'IRTC', '450056'], // CIK 1388658 iRhythm Holdings, Inc., former EDGAR name until 2026-01-12
    ['ISSUER DIRECT', 'ACCS', '46520M'], // CIK 843006 ACCESS Newswire Inc., former EDGAR name until 2025-01-16
    ['JANOVER', 'DFDV', '47100L'], // CIK 1805526 DeFi Development Corp., former EDGAR name until 2025-04-15
    ['JOHN BEAN TECHNOLOGIES', 'JBTM', '477839'], // CIK 1433660 JBT MAREL Corp, former EDGAR name until 2024-12-20
    ['LENDINGCLUB', 'HAPN', '52603A'], // CIK 1409970 Happen, Inc., former EDGAR name until 2026-06-18
    ['LIXTE BIOTECHNOLOGY HOLDINGS', 'NMAD', '539319'], // CIK 1335105 NOMAD POWER SOLUTIONS, INC., former EDGAR name until 2026-07-02
    ['MKS INSTRUMENTS', 'MKSI', '55306N'], // CIK 1049502 MKS INC, former EDGAR name until 2025-05-15
    ['MONTANA TECHNOLOGIES', 'AIRJ', '612160'], // CIK 1855474 AirJoule Technologies Corp., former EDGAR name until 2024-10-21
    ['MULTIPLAN', 'CTEV', '62548M'], // CIK 1793229 Claritev Corp, former EDGAR name until 2025-02-07
    ['NEWPARK RESOURCES', 'NPKI', '651718'], // CIK 71829 NPK International Inc., former EDGAR name until 2024-12-03
    ['ONCOLOGY INSTITUTE', 'STLN', '68236X'], // CIK 1799191 Starling Oncology, Inc., former EDGAR name until 2026-08-03
    ['OREILLY AUTOMOTIVE', 'ORLY', '67103H'], // CIK 898173 O REILLY AUTOMOTIVE INC, former EDGAR name until 1998-04-10
    ['ORION OFFICE REIT', 'ONL', '68629Y'], // CIK 1873923 Orion Properties Inc., former EDGAR name until 2025-03-07
    ['PALTALK', 'IPM', '69764K'], // CIK 1355839 INTELLIGENT PROTECTION MANAGEMENT CORP., former EDGAR name until 2025-01-02
    ['PARAMOUNT SKYDANCE', 'SKYD', '69932A'], // CIK 2041610 Skydance Corp, former EDGAR name until 2026-10-06
    ['PIEDMONT OFFICE REALTY TRUST', 'PDM', '720190'], // CIK 1042776 Piedmont Realty Trust, Inc., former EDGAR name until 2025-06-02
    ['PIERIS PHARMACEUTICALS', 'PVLA', '697947'], // CIK 1583648 PALVELLA THERAPEUTICS, INC., former EDGAR name until 2024-12-12
    ['PLUS THERAPEUTICS', 'CNSY', '72941H'], // CIK 1095981 CERENOME, INC., former EDGAR name until 2026-07-01
    ['RUMBLE', 'RUM', '78137L'], // CIK 1830081 RUM Group Inc., former EDGAR name until 2026-06-17
    ['SCHWEITZER MAUDUIT INTERNATIONAL', 'MATV', '808541'], // CIK 1000623 Mativ Holdings, Inc., former EDGAR name until 2022-07-01
    ['SEQLL', 'CIRC', '048592'], // CIK 1605888 CIRCLE8 GROUP INC, former EDGAR name until 2024-06-06
    ['SHOE CARNIVAL', 'SHOE', '824889'], // CIK 895447 SHOE STATION GROUP INC, former EDGAR name until 2026-06-11
    ['TANGER FACTORY OUTLET CENTERS', 'SKT', '875465'], // CIK 899715 TANGER INC., former EDGAR name until 2023-11-15
    ['TECNOGLASS', 'TGLS', '87877F'], // CIK 1534675 Tecnoglass Holdings Inc., former EDGAR name until 2026-07-07
    ['TEMPUR SEALY INTERNATIONAL', 'SGI', '88023U'], // CIK 1206264 SOMNIGROUP INTERNATIONAL INC., former EDGAR name until 2025-02-14
    ['TEVOGEN BIO HOLDINGS', 'TVGN', '88165K'], // CIK 1860871 Tevogen Inc., former EDGAR name until 2026-07-30
    ['TORO COMBINECO', 'TTGT', '87874R'], // CIK 2018064 TechTarget, Inc., former EDGAR name until 2024-11-20
    ['VIAD', 'PRSU', '92552R'], // CIK 884219 Pursuit Attractions & Hospitality, Inc., former EDGAR name until 2024-12-31
    ['WELLGISTICS HEALTH', 'MEDS', '949503'], // CIK 2030763 DataMeds AI, Inc., former EDGAR name until 2026-07-21
    ['ZOOM VIDEO COMMUNICATIONS', 'ZM', '98980L'], // CIK 1585521 Zoom Communications, Inc., former EDGAR name until 2024-11-12
    ['ZYMEWORKS DELAWARE', 'ZYME', '98985Y'], // CIK 1937653 Zymeworks Inc., former EDGAR name until 2022-10-13
  ];
}

/** Nasdaq Trader symbol directories: Nasdaq listings, and NYSE, NYSE American, NYSE Arca, Cboe and IEX listings. */
export function nportUsListingsUrls(): string[] {
  return ['https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt', 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt'];
}

/**
 * The Nasdaq Trader symbol directories (the texts of `nportUsListingsUrls()`, in any order) as U.S.-listed symbol -> security
 * name; test issues and ETFs left out, CQS class dots as SEC dashes (`BRK.B` -> `BRK-B`). An issuer listed under several
 * symbols (Liberty Global LBTYA, LBTYB, LBTYK) also gets the entry `\u0000<name key>` -> its symbols, which `nportUsListed` reads
 * to require the share class. null unless every text is a whole directory (a header with Security Name and the File Creation
 * Time footer), so a failed or cut download changes nothing.
 */
export function parseUsListings(texts: ReadonlyArray<string>): Map<string, string> | null {
  const listings = new Map<string, string>();
  if (!texts.length) return null;
  for (let t = 0; t < texts.length; t++) {
    const lines = String(texts[t] === null || texts[t] === undefined ? '' : texts[t]).split(/\r?\n/).filter((line) => line.trim());
    const header = (lines[0] || '').split('|').map((cell) => cell.trim().toUpperCase());
    const nameAt = header.indexOf('SECURITY NAME'), testAt = header.indexOf('TEST ISSUE'), etfAt = header.indexOf('ETF');
    if (nameAt < 0 || !/^FILE CREATION TIME/i.test(lines[lines.length - 1] || '')) return null;
    for (let i = 1; i < lines.length - 1; i++) {
      const cells = lines[i].split('|');
      const symbol = String(cells[0] || '').trim().toUpperCase().replace(/[./ ]/g, '-');
      if (!symbol || String(cells[testAt] || '').trim() === 'Y' || String(cells[etfAt] || '').trim() === 'Y' || listings.has(symbol)) continue;
      listings.set(symbol, String(cells[nameAt] || '').trim());
    }
  }
  const issuers = new Map<string, string[]>();
  const loose = new Map<string, string[]>();
  listings.forEach((name, symbol) => {
    const key = nportNameKey(nportIssuerName(name));
    if (key) issuers.set(key, (issuers.get(key) || []).concat(symbol));
    const looseKey = nportLooseKey(nportIssuerName(name));
    if (looseKey && nportListedCommon(name)) loose.set(looseKey, (loose.get(looseKey) || []).concat(symbol));
  });
  issuers.forEach((symbols, key) => { if (symbols.length > 1) listings.set(`\u0000${key}`, symbols.join(' ')); });
  loose.forEach((symbols, looseKey) => listings.set(`\u0001${looseKey}`, symbols.join(' ')));
  return listings;
}

/** Is a symbol directory security name a company's own common or ordinary shares (not preferred, depositary, notes, warrants, units, rights)? */
function nportListedCommon(name: string): boolean {
  return !/\bDEPOSITARY\b|\bADSS?\b|\bADRS?\b|\bREGISTRY\b|\bPREFERRED\b|\bPREF\b|\bPFD\b|\bNOTES?\b|\bDEBENTURES?\b|\bWARRANTS?\b|\bUNITS?\b|\bRIGHTS?\b|%|\bDUE\s+\d{4}\b|\bPERPETUAL\b|\bCUMULATIVE\b|\bSUBORDINATED\b|\bTRUST\s+(?:SECURITIES|CERTIFICATES)\b|\bETNS?\b|\bEXCHANGE[- ]TRADED\b/i.test(name);
}

/** The share class a name or title states (`Class C`, `CL C`, `Series A`, `LIBERTY GLOBAL-C`), '' for none. */
function nportShareClass(...texts: unknown[]): string {
  for (let i = 0; i < texts.length; i++) {
    const text = String(texts[i] === null || texts[i] === undefined ? '' : texts[i]);
    const match = /\b(?:CLASS|CL|SERIES|SER)\.?\s+([A-Z])\b/i.exec(text) || /[A-Z]-\s?([A-Z])(?:\s|$)/i.exec(text);
    if (match) return match[1].toUpperCase();
  }
  return '';
}

/** Both symbol directories through the brand's `getText`, null when one fails (`parseUsListings`); load once per run. */
export async function readUsListings(getText: (url: string, label: string) => Promise<string>): Promise<Map<string, string> | null> {
  try {
    return parseUsListings(await Promise.all(nportUsListingsUrls().map((url) => getText(url, `Nasdaq Trader ${url.replace(/^.*\//, '')}`))));
  } catch {
    return null;
  }
}

/** A security or sheet name without its share description: `Accenture plc Class A Ordinary Shares (Ireland)` -> `Accenture plc`. */
function nportIssuerName(value: unknown): string {
  return String(value === null || value === undefined ? '' : value).split(' - ')[0]
    .replace(/\s+(?:\(|(?:CLASS|SERIES)\s+[A-Z]\b|COMMON\b|ORDINARY\b|SUBORDINATE\b|SUB\.?\s+VOT|(?:LIMITED|RESTRICTED)\s+VOTING\b|VOTING\b|SHARES?\b|STOCK\b|AMERICAN\s+DEPOSITARY\b|TRADING\s+UNDER\b)[\s\S]*$/i, '');
}

/**
 * Is `ticker` the company's own U.S. listing? The Nasdaq Trader directories (`parseUsListings`) list it under the same company
 * (same name key, or one key the start of the other: `BUNGE GLOBAL` and the directory's `BUNGE`, a name cut short after two words
 * or more: `CHECK POINT SOFTWARE TECH`), and not as depositary or New York registry shares, which are another security than
 * the foreign line (Shell's SHEL ADR, ASML's New York shares). When the issuer has several listed classes, the name or title
 * must state the listed class (Liberty Latin America Class C is LILAK, not LILA). False without listings. Callers check that
 * the line trades in U.S. dollars: a Toronto or London line of the same company in its own currency never gets the U.S. ticker.
 */
export function nportUsListed(listings: Map<string, string> | null, ticker: string, name: unknown, title: unknown = ''): boolean {
  if (!listings) return false;
  const listed = listings.get(String(ticker).trim().toUpperCase().replace(/[./ ]/g, '-'));
  if (listed === undefined || /\bDEPOSITARY\b|\bADSS?\b|\bADRS?\b|\bREGISTRY\b/i.test(listed)) return false;
  const a = nportNameKey(nportIssuerName(listed)), b = nportNameKey(nportIssuerName(name));
  if (!a || !b) return false;
  const short = a.length < b.length ? a : b, long = a.length < b.length ? b : a;
  if (a !== b && !(short.length >= 4 && long.indexOf(`${short} `) === 0) && !(short.split(' ').length >= 2 && long.indexOf(short) === 0)) return false;
  const listedClass = nportShareClass(listed);
  return !listedClass || !listings.has(`\u0000${a}`) || nportShareClass(name, title) === listedClass;
}

/**
 * Exchange tickers for the positions, in their order ('' for none). A ticker is given only to a common-stock row (assetCat
 * EC; a preferred EP, a CVR, right, warrant or escrow line gets none, a name match would give it the issuer's common ticker):
 * - U.S. ISIN or none, traded in USD (or with no currency): the filer's own `<ticker value>`, else the SEC issuer-name table
 *   (`names`) when the row has a CUSIP or a U.S. ISIN, else a renamed issuer (`nportRenamedIssuers`)
 * - foreign ISIN (Linde IE, NXP NL, IMAX CA): only traded in USD and only when the symbol directories (`listings`,
 *   `parseUsListings`) confirm the filer's or the name-matched ticker for the same company (`nportUsListed`); a local line in
 *   another currency, and every foreign row without listings, gets none
 * A ticker that lands on two different securities (Alphabet A and C, an ordinary share and its ADR) is dropped from the
 * name-matched rows; when the filer itself gave it to two securities it is dropped from all of them. Rows still without a
 * ticker get the second, looser name match (`nportLooseTickers`), which never changes a ticker given here. Bonds, cash, funds
 * and derivatives stay identifier-keyed.
 */
export function nportTickers(positions: ReadonlyArray<NportPosition>, names: Map<string, string> | null = null, listings: Map<string, string> | null = null): string[] {
  const fromFiler: boolean[] = [];
  const secTickers = new Set<string>();
  if (names) names.forEach((ticker, key) => { if (key.charAt(0) !== '\u0001') secTickers.add(ticker); });
  const renames = nportRenamedIssuers();
  const renamed = (position: NportPosition, key: string): string => {
    const issuer = (position.cusip || (/^US[0-9A-Z]{10}$/.test(position.isin) ? position.isin.slice(2, 11) : '')).slice(0, 6);
    const hit = renames.filter((entry) => entry[0] === key && entry[2] === issuer && secTickers.has(entry[1]))[0];
    return hit ? hit[1] : '';
  };
  const tickers = positions.map((position, index) => {
    fromFiler[index] = false;
    const equity = position.assetCat === 'EC' && !position.derivative && !nportIsRight(position);
    const foreign = Boolean(position.isin) && position.isin.slice(0, 2) !== 'US';
    const usd = foreign ? position.currency === 'USD' && Boolean(listings) : !position.currency || position.currency === 'USD';
    if (!equity || !usd) return '';
    const filer = /^[A-Z][A-Z0-9.-]{0,9}$/.test(position.ticker) ? position.ticker : '';
    const key = nportNameKey(position.name);
    const named = names && (/^[0-9A-Z]{9}$/.test(position.cusip) || /^[A-Z]{2}[0-9A-Z]{10}$/.test(position.isin)) ? names.get(key) || names.get(key.replace(/ CL [A-Z]$/, '')) || '' : '';
    if (!foreign) {
      fromFiler[index] = Boolean(filer);
      return filer || named || (names ? renamed(position, key) : '');
    }
    if (filer && nportUsListed(listings, filer, position.name, position.title)) {
      fromFiler[index] = true;
      return filer;
    }
    return named && nportUsListed(listings, named, position.name, position.title) ? named : '';
  });
  const securities = new Map<string, { keys: string[]; filer: string[] }>();
  tickers.forEach((ticker, index) => {
    if (!ticker) return;
    const position = positions[index];
    const key = position.cusip || position.isin || position.other || nportNameKey(position.name);
    const seen = securities.get(ticker) || { keys: [], filer: [] };
    if (seen.keys.indexOf(key) < 0) seen.keys.push(key);
    if (fromFiler[index] && seen.filer.indexOf(key) < 0) seen.filer.push(key);
    securities.set(ticker, seen);
  });
  const exact = tickers.map((ticker, index) => {
    const seen = ticker ? securities.get(ticker) : undefined;
    if (!seen || seen.keys.length < 2) return ticker;
    return seen.filer.length === 1 && fromFiler[index] ? ticker : '';
  });
  return nportLooseTickers(positions, exact, names, listings);
}

/**
 * The second name match (open-items etfs Q35) for the common-stock rows `nportTickers` left without a ticker; the tickers it
 * already gave never change. The row's loose key (`nportLooseKey`) must name one company: in the SEC table (`\u0001` entries of
 * `parseSecCompanyNames`, one CIK) and/or in the symbol directories (`\u0001` entries of `parseUsListings`, common shares only),
 * and when both know the key they must agree on the company. Of that company's tickers only its listed common shares count
 * (with one SEC ticker and no listing, that ticker); several of them (Fox, Lennar, Zillow) need the class the row states in its
 * name or title, matched to the listed security name, else no ticker. A foreign ISIN needs the directory listing of the same
 * key (its own U.S. shares, never depositary ones). A ticker that a row of `exact` holds for another security, or that this pass
 * finds for two securities, is dropped.
 */
function nportLooseTickers(positions: ReadonlyArray<NportPosition>, exact: string[], names: Map<string, string> | null, listings: Map<string, string> | null): string[] {
  if (!names) return exact;
  const companyOf = new Map<string, string>();
  names.forEach((tickers, key) => { if (key.charAt(0) === '\u0001' && tickers) tickers.split(' ').forEach((ticker) => companyOf.set(ticker, key)); });
  const securityOf = (position: NportPosition): string => position.cusip || position.isin || position.other || nportNameKey(position.name);
  const listedClass = (symbol: string): string => nportShareClass(listings ? listings.get(symbol) : '');
  const found = positions.map((position, index) => {
    if (exact[index] || position.assetCat !== 'EC' || position.derivative || nportIsRight(position)) return '';
    const foreign = Boolean(position.isin) && position.isin.slice(0, 2) !== 'US';
    if (foreign ? position.currency !== 'USD' || !listings : position.currency && position.currency !== 'USD') return '';
    if (!/^[0-9A-Z]{9}$/.test(position.cusip) && !/^[A-Z]{2}[0-9A-Z]{10}$/.test(position.isin)) return '';
    const key = nportLooseKey(position.name);
    if (!key) return '';
    const sec = names.get(`\u0001${key}`);
    const listed = listings ? listings.get(`\u0001${key}`) : undefined;
    if (sec === '' || (sec === undefined && listed === undefined) || (foreign && !listed)) return '';
    const listedSymbols = listed ? listed.split(' ') : [];
    // the company: the SEC entry of the key, else the one SEC entry every listed symbol of the key belongs to
    const company = sec !== undefined ? `\u0001${key}` : companyOf.get(listedSymbols[0]) || '';
    if (!company || listedSymbols.some((symbol) => companyOf.get(symbol) !== company)) return '';
    const tickers = String(names.get(company) || '').split(' ').filter(Boolean);
    const common = tickers.filter((ticker) => listings && listings.has(ticker) && nportListedCommon(String(listings.get(ticker))));
    const candidates = common.length ? common : tickers.length === 1 && !foreign ? tickers : [];
    if (foreign && candidates.some((ticker) => listedSymbols.indexOf(ticker) < 0)) return '';
    const wanted = nportShareClass(position.name, position.title);
    if (candidates.length === 1) return !wanted || !listings || !listings.has(candidates[0]) || !listedClass(candidates[0]) || listedClass(candidates[0]) === wanted ? candidates[0] : '';
    const classed = wanted ? candidates.filter((ticker) => listedClass(ticker) === wanted) : [];
    return classed.length === 1 ? classed[0] : '';
  });
  const taken = new Map<string, string[]>();
  exact.forEach((ticker, index) => { if (ticker) taken.set(ticker, (taken.get(ticker) || []).concat(securityOf(positions[index]))); });
  found.forEach((ticker, index) => {
    if (!ticker) return;
    const seen = taken.get(ticker) || [];
    if (seen.indexOf(securityOf(positions[index])) < 0) taken.set(ticker, seen.concat(securityOf(positions[index])));
  });
  return exact.map((ticker, index) => ticker || (found[index] && (taken.get(found[index]) || []).length === 1 ? found[index] : ''));
}

/** The browse-edgar Atom feed of one series' NPORT-P filings. */
export function nportSeriesFeedUrl(seriesId: string, count = 10): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(String(seriesId).toUpperCase())}&type=NPORT-P&dateb=&owner=include&count=${count}&output=atom`;
}

/** The registrant's submissions JSON (report periods of its recent filings). */
export function nportSubmissionsUrl(cik: string): string {
  return `https://data.sec.gov/submissions/CIK${`0000000000${Number(String(cik).replace(/\D/g, '')) || 0}`.slice(-10)}.json`;
}

/** primary_doc.xml of a filing in the registrant's own folder. Throws without a registrant CIK: the accession prefix is the filer agent. */
export function nportDocumentUrl(registrantCik: string, accession: string): string {
  const cik = Number(String(registrantCik).replace(/\D/g, ''));
  if (!cik) throw new Error(`N-PORT ${accession}: no registrant CIK (the accession prefix is the filer agent, never used as the folder)`);
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${String(accession).replace(/-/g, '')}/primary_doc.xml`;
}

/** NPORT-P entries of a browse-edgar Atom feed (amendments and other forms skipped), with the registrant CIK of the filing link. */
export function parseNportFeed(atom: string): NportCandidate[] {
  const out: NportCandidate[] = [];
  const entries = /<entry>([\s\S]*?)<\/entry>/gi;
  let entry: RegExpExecArray | null;
  while ((entry = entries.exec(String(atom === null || atom === undefined ? '' : atom))) !== null) {
    const body = entry[1];
    const form = (nportTag(body, 'filing-type') || nportAttr(body, 'category', 'term')).toUpperCase();
    const accession = nportTag(body, 'accession-number');
    if (form !== 'NPORT-P' || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) continue;
    const folder = /\/Archives\/edgar\/data\/(\d+)\//i.exec(nportTag(body, 'filing-href'));
    out.push({ accession, filed: nportIso(nportTag(body, 'filing-date')), period: nportIso(nportTag(body, 'period')), cik: folder ? folder[1] : '' });
  }
  return out;
}

/** NPORT-P filings of a registrant's submissions JSON (`filings.recent`), with report periods; the registrant is the JSON's own CIK. */
export function parseNportSubmissions(payload: unknown): NportCandidate[] {
  const record = (payload && typeof payload === 'object' ? payload : {}) as { cik?: unknown; filings?: { recent?: Record<string, unknown> } };
  const recent = record.filings && record.filings.recent ? record.filings.recent : {};
  const column = (name: string): unknown[] => (Array.isArray(recent[name]) ? (recent[name] as unknown[]) : []);
  const forms = column('form'), accessions = column('accessionNumber'), filed = column('filingDate'), periods = column('reportDate');
  const cik = String(record.cik === null || record.cik === undefined ? '' : record.cik).replace(/\D/g, '');
  const out: NportCandidate[] = [];
  for (let i = 0; i < forms.length; i++) {
    const accession = String(accessions[i] === null || accessions[i] === undefined ? '' : accessions[i]);
    if (String(forms[i]).toUpperCase() !== 'NPORT-P' || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) continue;
    out.push({ accession, filed: nportIso(filed[i]), period: nportIso(periods[i]), cik });
  }
  return out;
}

/**
 * Candidates newest report period first, then newest filing: a late filing for an older period never wins. A missing
 * period is taken from `known` (the registrant's submissions) by accession; candidates still without one go last.
 */
export function nportNewestFirst(candidates: ReadonlyArray<NportCandidate>, known: ReadonlyArray<NportCandidate> = []): NportCandidate[] {
  const periods = new Map<string, string>();
  for (let i = 0; i < known.length; i++) if (known[i].period) periods.set(known[i].accession, known[i].period);
  return candidates
    .map((candidate) => (candidate.period ? candidate : { ...candidate, period: periods.get(candidate.accession) || '' }))
    .sort((a, b) => (a.period && b.period ? b.period.localeCompare(a.period) : a.period ? -1 : b.period ? 1 : 0) || b.filed.localeCompare(a.filed));
}

/**
 * Does the filing belong to the fund? With a series id: only the same series id. Without one: the normalized series name
 * equals the fund name, or (`loose`, reported to the caller) one contains the other. Returns the problem, or null.
 */
export function nportIdentity(filing: Pick<NportFiling, 'seriesId' | 'seriesName'>, fund: { seriesId?: string | null; name?: string | null }): { problem: string | null; loose: boolean } {
  const wantedSeries = String(fund.seriesId || '').trim().toUpperCase();
  if (wantedSeries) return { problem: filing.seriesId === wantedSeries ? null : `names series ${filing.seriesId || 'none'}, not ${wantedSeries}`, loose: false };
  const filed = nportNameKey(filing.seriesName), wanted = nportNameKey(fund.name);
  if (!filed || !wanted) return { problem: 'no series id and no fund name to match', loose: false };
  if (filed === wanted) return { problem: null, loose: false };
  if (filed.indexOf(wanted) >= 0 || wanted.indexOf(filed) >= 0) return { problem: null, loose: true };
  return { problem: `names series "${filing.seriesName}", not "${String(fund.name)}"`, loose: false };
}

/**
 * May a filing replace the published holdings? Nothing published (no rows): any dated or undated report. Otherwise only a
 * report period strictly newer than the published holdings date; both must be ISO dates (convert the brand's display
 * date first), an unknown date on either side keeps the published sheet.
 */
export function nportIsFresh(repPdDate: unknown, publishedAsOf: unknown, publishedRows: unknown): boolean {
  if (!(Number(publishedRows) > 0)) return true;
  const report = nportIso(repPdDate), published = nportIso(publishedAsOf);
  return Boolean(report && published && String(publishedAsOf).trim().length === 10 && report > published);
}

export type NportRead = { filing: NportFiling; candidate: NportCandidate; url: string; loose: boolean } | { problem: string };

/**
 * The newest N-PORT-P filing of one fund, or why there is none. Candidates: the series' Atom feed (when a series id is known;
 * an empty feed means no filing yet) with periods from the registrant's submissions, else (no series id, or the feed failed)
 * the registrant's NPORT-P filings themselves; newest period first.
 * Documents are read until one passes the identity check (at most `maxDocuments`); that newest own filing is returned only
 * when it is fresh against the published holdings (`published.asOf` ISO, `published.rows`). Errors of the optional
 * submissions request are tolerated; others come back as `problem`. `cache` (one Map per run) keeps the submissions and
 * the parsed documents, so funds of one registrant share requests.
 */
export async function readNportHoldings(
  fund: { ticker: string; cik: string; seriesId?: string | null; name?: string | null },
  published: { asOf?: unknown; rows?: unknown },
  getText: (url: string, label: string) => Promise<string>,
  options: { maxDocuments?: number; cache?: Map<string, unknown> } = {},
): Promise<NportRead> {
  const cache = options.cache || new Map<string, unknown>();
  const once = async <T>(key: string, load: () => Promise<T>): Promise<T> => {
    if (!cache.has(key)) cache.set(key, load().catch((error: unknown) => { cache.delete(key); throw error; }));
    return (await cache.get(key)) as T;
  };
  const cik = String(fund.cik || '').replace(/\D/g, '');
  if (!Number(cik)) return { problem: `${fund.ticker}: no registrant CIK` };
  let known: NportCandidate[] = [];
  try {
    known = await once(`submissions:${Number(cik)}`, async () => parseNportSubmissions(JSON.parse(await getText(nportSubmissionsUrl(cik), `${fund.ticker} N-PORT periods`))));
  } catch {
    known = [];
  }
  // null: no series feed (no series id, or the feed failed), so the registrant's own NPORT-P filings are scanned instead
  let candidates: NportCandidate[] | null = null;
  try {
    if (fund.seriesId) candidates = parseNportFeed(await getText(nportSeriesFeedUrl(fund.seriesId), `${fund.ticker} N-PORT filings`));
  } catch (error) {
    if (!known.length) return { problem: `${fund.ticker}: N-PORT filings unavailable (${error instanceof Error ? error.message : String(error)})` };
  }
  const sorted = nportNewestFirst(candidates || known, known);
  if (!sorted.length) return { problem: `${fund.ticker}: no NPORT-P filing yet` };
  const limit = Math.max(1, options.maxDocuments || (candidates ? 3 : 12));
  const misses: string[] = [];
  for (let i = 0; i < sorted.length && i < limit; i++) {
    const candidate = sorted[i];
    const url = nportDocumentUrl(Number(candidate.cik) ? candidate.cik : cik, candidate.accession);
    let filing: NportFiling;
    try {
      filing = await once(`document:${url}`, async () => parseNportFiling(await getText(url, `${fund.ticker} N-PORT ${candidate.accession}`)));
    } catch (error) {
      misses.push(`${candidate.accession} unreadable (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    const identity = nportIdentity(filing, fund);
    if (identity.problem) {
      misses.push(`${candidate.accession} ${identity.problem}`);
      continue;
    }
    if (!filing.positions.length) return { problem: `${fund.ticker}: ${candidate.accession} has no positions` };
    if (!nportIsFresh(filing.repPdDate, published.asOf, published.rows)) return { problem: `${fund.ticker}: N-PORT ${filing.repPdDate || 'undated'} is not newer than the published holdings (${String(published.asOf || 'undated')})` };
    return { filing, candidate, url, loose: identity.loose };
  }
  return { problem: `${fund.ticker}: no N-PORT-P filing of its own${misses.length ? `: ${misses.join('; ')}` : ''}` };
}
// </nport-reader>

// <calendar-dates> shared block of .claude/tools/etfs/etf-std/calendar-dates.block.ts, applied by apply-block.ts: never edit it in one repo
/**
 * A calendar date as ISO `YYYY-MM-DD`, or null. Pure text work, never `Date.parse` or local getters, so a run in Tokyo
 * publishes the same day as CI (open-items etfs ETF-H4). Accepts ISO (`2026-10-24`, with a time the date part is kept as
 * written), `2026/10/24`, U.S. `10/24/2026` and `10-24-26` (two-digit years up to 69 are 20xx), month names in either order
 * (`Oct 24, 2026`, `October 24 2026`, `Sept. 30, 2026`, `24 Oct 2026`, `24-Oct-26`), an optional weekday or `as of` in front.
 * A day that does not exist (`02/30/2026`) is null.
 */
export function calendarIso(value: unknown): string | null {
  const text = String(value === null || value === undefined ? '' : value).replace(/[\s ]+/g, ' ').trim()
    .replace(/^as of:? /i, '').replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,? /i, '');
  const year = (raw: string): number => (raw.length === 2 ? (Number(raw) <= 69 ? 2000 : 1900) + Number(raw) : Number(raw));
  const month = (raw: string): number => {
    const word = raw.toLowerCase();
    const names = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    for (let i = 0; i < names.length; i++) if (word.length >= 3 && names[i].indexOf(word) === 0) return i + 1;
    return 0;
  };
  let y = 0, m = 0, d = 0, match: RegExpExecArray | null;
  if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text)) || (match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text))) {
    y = Number(match[1]); m = Number(match[2]); d = Number(match[3]);
  } else if ((match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})$/.exec(text))) {
    y = year(match[3]); m = Number(match[1]); d = Number(match[2]);
  } else if ((match = /^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/.exec(text))) {
    y = Number(match[3]); m = month(match[1]); d = Number(match[2]);
  } else if ((match = /^(\d{1,2})(?:st|nd|rd|th)?[ -]([A-Za-z]{3,9})\.?,?[ -](\d{4}|\d{2})$/.exec(text))) {
    y = year(match[3]); m = month(match[2]); d = Number(match[1]);
  } else {
    return null;
  }
  const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1 || d > days[m - 1]) return null;
  return `${y}-${m < 10 ? '0' : ''}${m}-${d < 10 ? '0' : ''}${d}`;
}

/**
 * Is the fund at least `years` old on `asOf`? Calendar anniversary, inclusive: a fund started 2025-10-24 is one year old on
 * 2026-10-24 (a 29 February start on 1 March). Unknown or unreadable dates answer true, so a value is never dropped for want
 * of a date. The shared "younger than one year" rule: since-inception returns are annualized only from one year on.
 */
export function fundAgeAtLeast(inception: unknown, asOf: unknown, years: number): boolean {
  const start = calendarIso(inception), end = calendarIso(asOf);
  if (!start || !end) return true;
  return end >= `${Number(start.slice(0, 4)) + years}${start.slice(4)}`;
}

/**
 * The returns with every horizon the fund is too young for set to null: `horizons` maps a key of `returns` to the years it
 * needs (`{ yr1: 1, cagr3y: 3, siAnn: 1 }`). Keys that are absent or already null stay as they are; the object is copied.
 */
export function withoutYoungReturns<T extends object>(returns: T, inception: unknown, asOf: unknown, horizons: Record<string, number>): T {
  const out: Record<string, unknown> = { ...(returns as Record<string, unknown>) };
  const keys = Object.keys(horizons);
  for (let i = 0; i < keys.length; i++) {
    if (out[keys[i]] !== undefined && out[keys[i]] !== null && !fundAgeAtLeast(inception, asOf, horizons[keys[i]])) out[keys[i]] = null;
  }
  return out as T;
}
// </calendar-dates>

// <fund-selection> shared block of .claude/tools/etfs/etf-std/fund-selection.block.ts, applied by apply-block.ts: never edit it in one repo
/** An index row as far as these helpers read it: the ticker and whether it has published data (`dataFile`, null for a catalog-only row). */
export type FundSelectionRow = { ticker?: unknown; dataFile?: unknown };

function fundSelectionTicker(row: FundSelectionRow): string {
  return String(row.ticker === null || row.ticker === undefined ? '' : row.ticker).trim().toUpperCase();
}

/**
 * The tickers a TICKERS entry may name: the live catalog plus every fund with published data (closed funds included). When
 * the live catalog could not be read (`live` null) every previous index row counts, since nothing tells a real catalog-only
 * row from a stale one. A catalog-only row from an earlier mistyped TICKERS run is therefore not "known" (open-items etfs Q27).
 */
export function knownTickers(live: ReadonlyArray<string> | null, previous: ReadonlyArray<FundSelectionRow>): string[] {
  const out: string[] = [];
  const add = (ticker: string): void => { if (ticker && out.indexOf(ticker) < 0) out.push(ticker); };
  if (live) for (let i = 0; i < live.length; i++) add(String(live[i]).trim().toUpperCase());
  for (let i = 0; i < previous.length; i++) if (!live || previous[i].dataFile) add(fundSelectionTicker(previous[i]));
  return out;
}

/** Throws before any fund request when TICKERS names a fund outside `known` (see knownTickers): a clear error, nothing fetched or written. */
export function assertKnownTickers(selected: ReadonlyArray<string> | null, known: ReadonlyArray<string>, where: string): void {
  const unknown = (selected || []).map((ticker) => String(ticker).trim().toUpperCase()).filter((ticker) => ticker && known.indexOf(ticker) < 0);
  if (unknown.length) throw new Error(`TICKERS: ${unknown.join(', ')} not in ${where}; nothing was fetched or written`);
}

/**
 * The index rows without stale catalog-only rows: a row with no published data whose ticker the live catalog no longer lists
 * (an earlier mistyped TICKERS entry, a fund withdrawn before launch). Rows with data always stay; nothing is dropped when the
 * live catalog could not be read (`live` null).
 */
export function withoutStalePlaceholders<T extends FundSelectionRow>(rows: ReadonlyArray<T>, live: ReadonlyArray<string> | null): T[] {
  if (!live) return rows.slice();
  const listed = live.map((ticker) => String(ticker).trim().toUpperCase());
  return rows.filter((row) => Boolean(row.dataFile) || listed.indexOf(fundSelectionTicker(row)) >= 0);
}

/**
 * New funds of a run (open-items etfs Q28): `published` - first published in this run (the previous index had no row for it,
 * or only a catalog-only one), so a fund whose first read failed is announced when it finally succeeds; `pending` - new in the
 * catalog this run but not published yet. Nothing is reported on a first run (empty previous index).
 */
export function newFundsReport(previous: ReadonlyArray<FundSelectionRow>, next: ReadonlyArray<FundSelectionRow>): { published: string[]; pending: string[] } {
  const report = { published: [] as string[], pending: [] as string[] };
  if (!previous.length) return report;
  const before = new Map<string, boolean>();
  for (let i = 0; i < previous.length; i++) before.set(fundSelectionTicker(previous[i]), Boolean(previous[i].dataFile));
  for (let i = 0; i < next.length; i++) {
    const ticker = fundSelectionTicker(next[i]);
    if (!ticker || before.get(ticker)) continue;
    if (next[i].dataFile) report.published.push(ticker);
    else if (!before.has(ticker)) report.pending.push(ticker);
  }
  report.published.sort();
  report.pending.sort();
  return report;
}

/** The log and step-summary lines of a newFundsReport: `NEW FUNDS: A, B` and `NEW FUNDS (not published yet): C`; none when empty. */
export function newFundsLines(report: { published: ReadonlyArray<string>; pending: ReadonlyArray<string> }): string[] {
  const lines: string[] = [];
  if (report.published.length) lines.push(`NEW FUNDS: ${report.published.join(', ')}`);
  if (report.pending.length) lines.push(`NEW FUNDS (not published yet): ${report.pending.join(', ')}`);
  return lines;
}
// </fund-selection>

// <range-52w> shared block of .claude/tools/etfs/etf-std/range-52w.block.ts, applied by apply-block.ts: never edit it in one repo
export type Range52w = {
  week52Low: number | null; week52High: number | null; range52w: number | null; range52wClose: number | null; range52wAsOf: string | null;
  range52wSince: string | null; range52wBasis: string | null;
};

/**
 * The price columns of a history sheet, tried in this order: the market close first, NAV only when no market price is
 * published. A function, not a const: the block sits at the end of update-data.ts, after the top-level `await main()`.
 */
export function range52wColumns(): string[] {
  return ['Close', 'Market Price', 'NAV', 'NAV per Share'];
}

/** The seven `metrics` keys of the 52-week range, all null: a catalog-only row and a fund without history carry this. */
export function range52wEmpty(): Range52w {
  return { week52Low: null, week52High: null, range52w: null, range52wClose: null, range52wAsOf: null, range52wSince: null, range52wBasis: null };
}

/**
 * The 52-week range from the closes of a fund's published history sheet (owner, 2026-10-29: closes, not intraday highs and
 * lows; no extra requests). `headers` are the sheet headers, `rows` objects keyed by header or arrays in header order.
 * - Price column: the first of range52wColumns() with at least two numeric values (`$1,234.50` reads as 1234.5); the date
 *   column is `Date`, else `As Of`, else the first header. Dates go through calendarIso, so every published format works
 * - Window: the last dated close and every close up to 52 weeks (364 days) before it. `week52Low` and `week52High` are the
 *   lowest and highest close of the window, `range52w` the position of the last close between them in percent
 *   (0 = at the low, 100 = at the high, 2 decimals). The last close is part of the window, so it never falls outside;
 *   `range52wClose` and `range52wAsOf` are that close and its date (it can differ from the row's closePrice source)
 * - A fund with less than 52 weeks of history gets the range since its first published close, and `range52wSince` names
 *   that date (owner: "alternative" - the range since launch with a note); a full window has `range52wSince: null`
 * - `range52wBasis` names the column used. Fewer than two closes give range52wEmpty(); a flat window (high = low) keeps
 *   low and high but `range52w: null`, never a made-up 0 or 50
 */
export function range52wMetrics(headers: string[], rows: unknown[]): Range52w {
  const list = Array.isArray(headers) ? headers.map((h) => String(h)) : [];
  const dateHeader = list.indexOf('Date') >= 0 ? 'Date' : list.indexOf('As Of') >= 0 ? 'As Of' : list[0];
  const cell = (row: unknown, header: string): unknown => {
    if (Array.isArray(row)) return row[list.indexOf(header)];
    return row && typeof row === 'object' ? (row as Record<string, unknown>)[header] : undefined;
  };
  const price = (value: unknown): number | null => {
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
    const text = String(value === null || value === undefined ? '' : value).replace(/[$,\s]/g, '');
    if (!/^\d+(\.\d+)?$/.test(text)) return null;
    const number = Number(text);
    return number > 0 ? number : null;
  };
  const all = Array.isArray(rows) ? rows : [], columns = range52wColumns();
  for (let c = 0; c < columns.length; c++) {
    const column = columns[c];
    if (list.indexOf(column) < 0 || !dateHeader) continue;
    const points: Array<{ date: string; close: number }> = [];
    for (let i = 0; i < all.length; i++) {
      const date = calendarIso(cell(all[i], dateHeader)), close = price(cell(all[i], column));
      if (date && close !== null) points.push({ date, close });
    }
    if (points.length < 2) continue;
    points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const last = points[points.length - 1];
    const end = Date.UTC(Number(last.date.slice(0, 4)), Number(last.date.slice(5, 7)) - 1, Number(last.date.slice(8, 10)));
    const start = new Date(end - 364 * 86400000).toISOString().slice(0, 10);
    const window = points.filter((p) => p.date >= start);
    if (window.length < 2) continue;
    let low = window[0].close, high = window[0].close;
    for (let i = 1; i < window.length; i++) { low = Math.min(low, window[i].close); high = Math.max(high, window[i].close); }
    const round = (value: number, digits: number): number => Number(value.toFixed(digits));
    return {
      week52Low: round(low, 4), week52High: round(high, 4),
      range52w: high > low ? round(((last.close - low) / (high - low)) * 100, 2) : null, range52wClose: round(last.close, 4), range52wAsOf: last.date,
      range52wSince: points[0].date > start ? points[0].date : null,
      range52wBasis: column,
    };
  }
  return range52wEmpty();
}
/**
 * The index rows with the five 52-week keys in every `metrics`, computed from each fund's published history pages
 * (`funds/<T>/history/*.json` under `feedRoot`, the folder of index.json). Call it on the final rows right before
 * index.json is written: updated, unchanged and kept funds all get the range of the history they publish, a row without
 * `dataFile` or without history pages gets range52wEmpty(). A row without a `metrics` object is left as it is. The seven
 * keys go in front of `returnsBasis` and `performanceAsOf`, so those two stay the last keys of `metrics`.
 */
export async function withRange52w<T>(feedRoot: URL | string, funds: T[]): Promise<T[]> {
  const fs = await import('node:fs/promises');
  const { pathToFileURL } = await import('node:url');
  const root = feedRoot instanceof URL ? new URL(feedRoot.href.replace(/\/?$/, '/')) : pathToFileURL(String(feedRoot).replace(/\/?$/, '/'));
  const out: T[] = [];
  for (const fund of Array.isArray(funds) ? funds : []) {
    const row = fund as unknown as Record<string, unknown>;
    if (!row || typeof row !== 'object' || !row.metrics || typeof row.metrics !== 'object') { out.push(fund); continue; }
    let range = range52wEmpty();
    const dataFile = typeof row.dataFile === 'string' ? row.dataFile : '';
    if (dataFile) {
      const dir = new URL(`${dataFile.replace(/^\.\//, '').replace(/[^/]*$/, '')}history/`, root);
      const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((name) => /\.json$/.test(name)).sort();
      let headers: string[] = [];
      const rows: unknown[] = [];
      for (const name of names) {
        const page = await fs.readFile(new URL(name, dir), 'utf8').then((text) => JSON.parse(text)).catch(() => null);
        if (!page || !Array.isArray(page.rows)) continue;
        if (!headers.length && Array.isArray(page.headers)) headers = page.headers;
        for (const item of page.rows) rows.push(item);
      }
      range = range52wMetrics(headers, rows);
    }
    // the range keys go in front of returnsBasis and performanceAsOf, which stay the last two keys (metrics contract)
    const metrics: Record<string, unknown> = {}, old = row.metrics as Record<string, unknown>, tail = ['returnsBasis', 'performanceAsOf'];
    for (const key of Object.keys(old)) if (tail.indexOf(key) < 0 && !(key in range)) metrics[key] = old[key];
    Object.assign(metrics, range);
    for (const key of tail) if (key in old) metrics[key] = old[key];
    out.push({ ...row, metrics } as unknown as T);
  }
  return out;
}
// </range-52w>
