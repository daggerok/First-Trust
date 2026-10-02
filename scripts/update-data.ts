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
  };
  const range = (v: any): string => v?.source ?? `${Number.isFinite(v?.min) ? v.min : ''}:${Number.isFinite(v?.max) ? v.max : ''}`;
  for (const [key, value] of Object.entries(config)) {
    const name = aliases[key] ?? key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
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
function outputPrintConfig(brand: string, config: Record<string, any>): void {
  const entries: [string, string][] = [...outputConfigEntries(config), ['VERBOSE', String(outputVerbose())]];
  console.log(`[ config   ] ${brand} updater:\n${entries.map(([key, value]) => `              ${key}=${/TOKEN|PASSWORD|SECRET|COOKIE|SEC_UA/i.test(key) ? '<redacted>' : outputClean(value)}`).join('\n')}`);
}
function outputHasOutputFilters(config: Record<string, any>): boolean {
  return outputConfigEntries(config).some(([name, value]) =>
    /^(TICKERS|CATEGORY|AUM|TER|DIVIDEND_YIELD|SEC_YIELD|PERFORMANCE_|TOTAL_RETURN_)/.test(name) &&
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
function outputMoney(value: any): string {
  const raw = outputScalar(value);
  if (raw === null || raw === undefined || raw === '—' || raw === '--') return 'null';
  const text = String(raw).replace(/[$,\s]/g, '');
  const match = text.match(/^([+-]?[\d.]+)([KMBT])?$/i);
  if (!match) return outputClean(raw);
  const number = Number(match[1]) * ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[match[2]?.toUpperCase() as 'K' | 'M' | 'B' | 'T'] ?? 1);
  if (!Number.isFinite(number)) return 'null';
  for (const [unit, scale] of [['T', 1e12], ['B', 1e9], ['M', 1e6], ['K', 1e3]] as const) {
    if (Math.abs(number) >= scale) return `$${(number / scale).toFixed(1)}${unit}`;
  }
  return `$${number.toFixed(2)}`;
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
    field('div', outputScalar(data.trailingYield ?? data.yields?.effectiveYield ?? data.yields?.dividendYield ?? data.dividendYield ?? metrics.dividendYield)),
    field('sec', outputScalar(data.secYield ?? data.yields?.secYield ?? metrics.secYield)),
    field('wp', data.workplaceRaw),
  ].filter(part => part !== '').join(' ');
  return `[ ${String(index).padStart(width)}/${String(total).padEnd(width)}  ] ${outputClean(ticker).padEnd(5)} ${status.padEnd(9)}${detail ? ` ${detail}` : ''}${reason ? ` reason=${outputClean(reason)}` : ''}`;
}
function outputCreateReporter(root: URL | string, total: number) {
  let completed = 0;
  return {
    before: (ticker: string) => outputInspectFund(root, ticker),
    async result(ticker: string, before: { digest: string }, status?: string, reason?: unknown, extra: any = {}) {
      const after = await outputInspectFund(root, ticker);
      console.log(outputFundLine(++completed, total, ticker, status ?? (before.digest === after.digest ? 'unchanged' : 'updated'), { ...after.meta, ...extra }, reason));
    },
  };
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

import { mkdir, readFile, writeFile, readdir, rm, appendFile } from 'node:fs/promises';
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

const SEC_DATA_HOST = 'https://data.sec.gov';
const SEC_EFTS_HOST = 'https://efts.sec.gov/LATEST';
const EDGAR_ARCHIVES = 'https://www.sec.gov/Archives/edgar/data';
const EDGAR_BROWSE_URL = 'https://www.sec.gov/cgi-bin/browse-edgar';
// Official SEC lookup tables (public, no key): ETF/mutual-fund ticker ->
// registrant CIK + series/class ids, and operating company name -> ticker.
const SEC_FUND_TICKERS_URL = 'https://www.sec.gov/files/company_tickers_mf.json';
const SEC_COMPANY_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
// SEC policy requires a declared contact; the repository Actions variable
// SEC_UA (or env SEC_UA) overrides this default.
const SEC_UA_DEFAULT = 'daggerok ETF feed daggerok@gmail.com';

const API_ROOT = new URL('../api/firsttrust/', import.meta.url);
const INDEX_FILE = new URL('index.json', API_ROOT);
const STATE_FILE = new URL('update-state.json', API_ROOT);

const HOLDINGS_PAGE_SIZE_FALLBACK = 250;
const HISTORY_PAGE_SIZE_FALLBACK = 1000;
const CONCURRENCY_FALLBACK = 2;
const REQUEST_SLEEP_FALLBACK = 1;
const MAX_RETRIES_FALLBACK = 2;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const HOLDINGS_HEADERS = ['Name', 'Ticker', 'Identifier', 'Weight', 'Market Value', 'Shares Held', 'Asset Category'];
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

// "2.97057744E8" -> "297057744"; keeps non-numeric text untouched (same as SPDR).
export function normalizeNumberText(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (text === '' || text === '-') return text;
  if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text.replace(/,/g, ''))) return text;
  const number = Number(text.replace(/,/g, ''));
  if (!Number.isFinite(number) || Math.abs(number) >= 1e21) return text;
  return number.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 10 });
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

// "08/21/2026" / "2026-08-21T00:00:00Z" -> "2026-08-21"; anything else passes
// through untouched so an unexpected source format never silently corrupts a
// date column.
export function toIsoDate(raw: unknown): string {
  const text = String(raw ?? '').trim();
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  return text;
}

// ISO date -> epoch seconds (UTC midnight), NaN-safe.
export function isoToEpoch(iso: string): number | null {
  const value = Date.parse(`${toIsoDate(iso)}T00:00:00Z`);
  return Number.isFinite(value) ? Math.floor(value / 1000) : null;
}

/** First Trust lists and tables print two-digit years ("01/06/14"); page headers use four. */
export function firstTrustIsoDate(raw: unknown): string {
  const text = String(raw ?? '').trim();
  const short = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(text);
  if (short) return toIsoDate(`${short[1]}/${short[2]}/${Number(short[3]) >= 70 ? '19' : '20'}${short[3]}`);
  return toIsoDate(text);
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

/** "max" or a whole number of years/months ("10y", "6mo"); anything else means "max". */
export function normalizeHistoryRange(raw: string): string {
  const text = String(raw ?? '').trim().toLowerCase();
  return /^(max|\d+y|\d+mo)$/.test(text) ? text : 'max';
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
  if (result.HISTORY_RANGE?.trim() && !/^(max|\d+y|\d+mo)$/i.test(result.HISTORY_RANGE.trim())) throw new Error('HISTORY_RANGE: expected max, Ny or Nmo');
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
                       starting from the first ticker; the cursor is reset.
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
  TER                  Total (gross) expense ratio range in percent.
  DIVIDEND_YIELD       12-month distribution rate range in percent.
  SEC_YIELD            30-day SEC yield range in percent.
  PERFORMANCE_YTD      Month-end NAV return ranges, average annualized for
                       periods of a year or more (also 1Y, 3Y, 5Y, 10Y).
  TOTAL_RETURN_YTD     Cumulative return ranges (also 1Y, 3Y, 5Y, 10Y).
  HOLDINGS_PAGE_SIZE   Rows per generated current-holdings JSON page (default 250).
  HISTORY_PAGE_SIZE    Rows per generated price-history JSON page (default 1000).
  HISTORY_RANGE        History window: max (default) or a whole number of
                       years/months such as 10y or 6mo (official export and
                       Yahoo fallback).
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
  let lane = 0;
  for (let i = 1; i < nextRequestAtLanes.length; i++) if (nextRequestAtLanes[i] < nextRequestAtLanes[lane]) lane = i;
  const waitFor = nextRequestAtLanes[lane] - Date.now();
  if (waitFor > 0) await sleep(waitFor);
  nextRequestAtLanes[lane] = Date.now() + requestSleepMs;
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
      const response = await fetch(url, { redirect: 'follow', ...init });
      if (response.ok) return response;
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
  return fetchText(firstTrustPageUrl(page, ticker, extra), `[product ] ${ticker} ${page}`, firstTrustHeaders(), config);
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

export type Fund = {
  ticker: string;
  name: string;
  category: string;
  navValue: number | null;
  aumValue: number | null;
  terValue: number | null;
  netExpenseRatio: number | null;
  dividendYield: number | null;
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
    ticker, name, category, navValue: null, aumValue: null, terValue: null, netExpenseRatio: null,
    dividendYield: null, secYield: null, unsubsidizedSecYield: null, inceptionListed: null, yieldAsOf: null,
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
  fund.terValue = performance.grossExpenseRatio ?? performance.netExpenseRatio ?? fund.terValue;
  fund.netExpenseRatio = performance.netExpenseRatio;
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
        Weight: numberText(cell(row, weightAt)) || '0',
        'Market Value': numberText(cell(row, valueAt)) || '0',
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

/** First export date for HISTORY_RANGE ("max", "10y", "6mo"), never before the fund's first price. */
export function historyStartDate(range: string, minDate: string, maxDate: string): string {
  const min = firstTrustIsoDate(minDate), max = firstTrustIsoDate(maxDate);
  const match = /^(\d+)(y|mo)$/.exec(normalizeHistoryRange(range));
  if (!match || !/^\d{4}-\d{2}-\d{2}$/.test(max)) return min;
  const end = new Date(`${max}T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() - Number(match[1]) * (match[2] === 'y' ? 12 : 1));
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
// daggerok/Fidelity use. N-PORT positions (EDGAR fallback) are resolved from
// the SEC company-ticker table.
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

export function normalizeHoldingNameCore(raw: unknown): string {
  return normalizeHoldingName(raw).replace(/ /g, '');
}

// Holding tickers keep their class-share markers (SCE^L, BF/A, BRK-B): they
// are the real exchange symbols, unlike fund tickers which sanitizeTicker
// upper-cases and strips everything but letters/digits.
const HOLDING_TICKER_PLACEHOLDERS = new Set(['', 'N/A', 'NA', 'NONE', 'NIL', 'NULL', '-', '--', '---', 'SEE FILE', 'VARIES']);

export function cleanHoldingTicker(raw: unknown): string {
  const symbol = String(raw ?? '').trim().toUpperCase();
  if (HOLDING_TICKER_PLACEHOLDERS.has(symbol)) return '';
  return /^[A-Z0-9][A-Z0-9.^/-]*$/.test(symbol) ? symbol : '';
}
// ---------------------------------------------------------------------------
// SEC EDGAR fallback layer: N-PORT-P positions for funds ftportfolios.com does
// not publish holdings for, resolved through the EDGAR full-text search API.
// ---------------------------------------------------------------------------

export type NportAccession = { accession: string; filed: string; reportDate: string; url: string };

export function nportUrlFor(cik: string, accession: string): string {
  return `${EDGAR_ARCHIVES}/${Number(String(cik).replace(/^0+/, '') || 0)}/${String(accession).replace(/-/g, '')}/primary_doc.xml`;
}

export function parseNportAccessions(submissions: JsonRecord): NportAccession[] {
  const recent = submissions?.filings?.recent;
  const result: NportAccession[] = [];
  if (!recent || !Array.isArray(recent.form)) return result;
  for (let i = 0; i < recent.form.length; i++) {
    if (recent.form[i] !== 'NPORT-P') continue;
    const accession: string = String(recent.accessionNumber?.[i] || '');
    if (!accession) continue;
    result.push({
      accession,
      filed: String(recent.filingDate?.[i] || ''),
      reportDate: String(recent.reportDate?.[i] || ''),
      url: nportUrlFor(String(submissions.cik || '0'), accession),
    });
  }
  return result;
}

// EDGAR publishes the authoritative "ticker -> registrant CIK + series id"
// table for every ETF and mutual fund class; it is the reliable way to reach a
// fund's own N-PORT-P filing (the full-text search is only a last resort).
export type SecSeriesRef = { cik: string; seriesId: string; classId: string };

export function parseFundTickerMap(payload: JsonRecord): Map<string, SecSeriesRef> {
  const map = new Map<string, SecSeriesRef>();
  const fields: string[] = Array.isArray(payload?.fields) ? payload.fields.map((field: unknown) => String(field)) : [];
  const rows: unknown[] = Array.isArray(payload?.data) ? payload.data : [];
  const at = (row: unknown[], field: string): string => {
    const index = fields.indexOf(field);
    return index >= 0 ? String(row[index] ?? '') : '';
  };
  for (const raw of rows) {
    if (!Array.isArray(raw)) continue;
    const ticker = sanitizeTicker(at(raw, 'symbol'));
    if (!ticker || map.has(ticker)) continue;
    const cik = at(raw, 'cik').replace(/\D/g, '');
    if (!cik || Number(cik) === 0) continue;
    map.set(ticker, {
      cik: cik.padStart(10, '0'),
      seriesId: at(raw, 'seriesId').toUpperCase(),
      classId: at(raw, 'classId').toUpperCase(),
    });
  }
  return map;
}

// Operating-company name -> exchange ticker, so N-PORT positions (which carry
// CUSIP/ISIN but never a ticker) still land in the watchlist with a symbol.
export function parseCompanyTickerMap(payload: JsonRecord): Map<string, string> {
  const map = new Map<string, string>();
  const rows = payload && typeof payload === 'object' ? Object.values(payload as JsonRecord) : [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const record = raw as JsonRecord;
    const ticker = cleanHoldingTicker(record.ticker);
    const title = String(record.title ?? '');
    if (!ticker || !title) continue;
    for (const key of [normalizeHoldingName(title), normalizeHoldingNameCore(title)]) {
      if (key && !map.has(key)) map.set(key, ticker);
    }
  }
  return map;
}

export function edgarSeriesFilingsUrl(seriesId: string, count = 10): string {
  const params = new URLSearchParams({
    action: 'getcompany',
    CIK: String(seriesId || '').toUpperCase(),
    type: 'NPORT-P',
    dateb: '',
    owner: 'include',
    count: String(count),
    output: 'atom',
  });
  return `${EDGAR_BROWSE_URL}?${params.toString()}`;
}

// browse-edgar's Atom feed for one series: the newest N-PORT-P accessions of
// exactly that fund, newest first.
export function parseEdgarAtomFilings(xml: string): NportAccession[] {
  const result: NportAccession[] = [];
  for (const entry of String(xml || '').matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
    const body = entry[1];
    const form = tagValue(body, 'filing-type') || tagValue(body, 'type');
    if (form && form.toUpperCase() !== 'NPORT-P') continue;
    const accession = tagValue(body, 'accession-number') || tagValue(body, 'accession-nunber');
    if (!accession) continue;
    const hrefMatch = /<filing-href>([\s\S]*?)<\/filing-href>/i.exec(body);
    const cikMatch = hrefMatch ? /\/edgar\/data\/(\d+)\//.exec(cleanText(hrefMatch[1])) : null;
    result.push({
      accession,
      filed: tagValue(body, 'filing-date'),
      reportDate: tagValue(body, 'period') || '',
      url: nportUrlFor(cikMatch ? cikMatch[1] : accession.slice(0, 10), accession),
    });
  }
  return result;
}

function tagValue(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  return match ? cleanText(match[1]) : '';
}

export type NportHolding = JsonRecord;

export type ParsedNport = {
  regName: string;
  regCik: string;
  seriesName: string;
  seriesId: string;
  repPdDate: string;
  holdings: NportHolding[];
  totalValue: number;
  netAssets: number | null;
};

// Minimal, forgiving N-PORT-P XML reader (machine-generated schemas only),
// in the same spirit as SPDR's hand-rolled ZIP/OOXML workbook reader.
export function parseNport(xml: string): ParsedNport {
  const genInfoMatch = /<genInfo>([\s\S]*?)<\/genInfo>/i.exec(xml);
  const genInfo = genInfoMatch ? genInfoMatch[1] : String(xml || '').slice(0, 4000);
  const fundInfoMatch = /<fundInfo>([\s\S]*?)<\/fundInfo>/i.exec(xml);
  const fundInfo = fundInfoMatch ? fundInfoMatch[1] : '';
  const holdings: NportHolding[] = [];
  const blockRe = /<invstOrSec>([\s\S]*?)<\/invstOrSec>/g;
  let block: RegExpExecArray | null;
  let totalValue = 0;
  while ((block = blockRe.exec(xml)) !== null) {
    const body = block[1];
    const name = tagValue(body, 'name') || tagValue(body, 'title') || '-';
    const cusip = tagValue(body, 'cusip');
    let identifier = cusip && cusip.toUpperCase() !== 'N/A' ? cusip : '';
    if (!identifier) {
      // Real EDGAR schema: <identifiers><isin value="..."/><other value="..."/></identifiers>
      for (const tagMatch of body.matchAll(/<(isin|sedol|other|cusip)[^>]*value="([^"]+)"/gi)) {
        identifier = cleanText(tagMatch[2]);
        if (identifier) break;
      }
    }
    const weight = normalizeNumberText(tagValue(body, 'pctVal'));
    const valueMatch = /<valUSD[^>]*>([\s\S]*?)<\/valUSD>/i.exec(body);
    const value = Number(valueMatch ? valueMatch[1].replace(/[,\s]/g, '') : tagValue(body, 'curVal'));
    const balance = normalizeNumberText(tagValue(body, 'balance'));
    holdings.push({
      Name: name,
      Ticker: '-',
      Identifier: identifier || '-',
      Weight: weight === '' ? '0' : weight,
      'Market Value': Number.isFinite(value) ? String(value) : '0',
      'Shares Held': balance === '' ? '-' : balance,
      'Asset Category': tagValue(body, 'assetCat') || '-',
    });
    if (Number.isFinite(value)) totalValue += value;
  }
  return {
    regName: tagValue(genInfo, 'regName'),
    regCik: tagValue(genInfo, 'regCik'),
    seriesName: tagValue(genInfo, 'seriesName'),
    seriesId: tagValue(genInfo, 'seriesId'),
    repPdDate: toIsoDate(tagValue(genInfo, 'repPdDate')),
    holdings,
    totalValue,
    netAssets: numberOrNull(normalizeNumberText(tagValue(fundInfo, 'netAssets'))),
  };
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

export function pickEftsCik(payload: JsonRecord, fundName: string): string | null {
  // EDGAR returns { hits: { hits: [...] } }; older/simplified payloads (and the
  // unit-test fixtures) use a flat { hits: [...] } array.
  const hits: unknown[] = Array.isArray(payload?.hits)
    ? (payload.hits as unknown[])
    : Array.isArray((payload?.hits as JsonRecord)?.hits)
      ? ((payload.hits as JsonRecord).hits as unknown[])
      : [];
  const wanted = normalizeHoldingName(fundName);
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
      const matched = names.some((name) => {
        const normalized = normalizeHoldingName(name.replace(/\(CIK\s*\d+\)/i, ''));
        return normalized && (wanted.includes(normalized) || normalized.includes(wanted));
      });
      if (!matched) continue;
    }
    return cik;
  }
  return null;
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

function chartUrl(ticker: string, config: UpdaterConfig): string {
  // Explicit period1/period2: `range=max` silently downgrades to monthly bars.
  const period2 = Math.floor(Date.now() / 1000);
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

export const RETURNS_BASIS = 'official First Trust NAV total returns (month-end performance table; cumulative 3y/5y/10y derived from the published annualized values)';

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
  fund.terValue = gross ?? net ?? fund.terValue;
  fund.netExpenseRatio = net ?? fund.netExpenseRatio;
  fund.aumValue = toNumber(summaryValue(summary, 'Total Net Assets', 'Net Assets')?.value) ?? fund.aumValue;
  fund.navValue = toNumber(summaryValue(summary, 'Closing NAV')?.value) ?? fund.navValue;
  fund.secYield = toNumber(summaryValue(summary, '30-Day SEC Yield')?.value) ?? fund.secYield;
  fund.dividendYield = toNumber(summaryValue(summary, '12-Month Distribution Rate')?.value) ?? fund.dividendYield;
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
  fund.dividendYield = toNumber(metrics.dividendYield);
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
  fund.dividendYield = fund.dividendYield ?? cached.dividendYield;
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
  const navValue = toNumber(nav.value), closeValue = toNumber(market.value), aumValue = toNumber(aum.value), terValue = toNumber(expense.value);
  const dividendYield = toNumber(yields.dividendYield), secYield = toNumber(yields.secYield);
  const withDisplayDate = (row: ReturnRow): JsonRecord => ({ ...row, asOfDate: row.asOfDate ? displayDate(row.asOfDate) : null });
  return {
    ticker: fund.ticker,
    name: String(meta.name ?? fund.name),
    category: String(meta.category ?? fund.category),
    fundPage: fundPageUrl(fund.ticker),
    dataFile: `./funds/${fund.ticker}/meta.json`,
    ter: formatPercent(terValue),
    terValue,
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
      secYield,
      secYieldText: secYield === null ? null : formatPercent(secYield),
      ...returnsProvenance(monthEnd),
    },
    holdings,
    history,
  };
}

/** Catalog-only entry (ETF list + NAV performance view) for funds that have never been fetched. */
export function catalogOnlyEntry(fund: Fund): JsonRecord {
  const nav = fund.navValue;
  const monthEnd = fund.returns?.monthEnd ?? emptyReturns();
  const quarterEnd = fund.returns?.quarterEnd ?? emptyReturns();
  const withDisplayDate = (row: ReturnRow): JsonRecord => ({ ...row, asOfDate: row.asOfDate ? displayDate(row.asOfDate) : null });
  return {
    ticker: fund.ticker,
    name: fund.name,
    category: fund.category,
    fundPage: fundPageUrl(fund.ticker),
    dataFile: `./funds/${fund.ticker}/meta.json`,
    ter: formatPercent(fund.terValue),
    terValue: fund.terValue,
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
  await mkdir(new URL('.', file), { recursive: true });
  await writeFile(file, next, 'utf8');
  return true;
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
  const keep = pageBasenames(pages);
  for (const entry of await readdir(folder).catch(() => [])) {
    if (entry.endsWith('.json') && !keep.has(entry)) await rm(new URL(entry, folder), { force: true });
  }
  return { pages, pageSize: size, totalRows: rows.length, asOfDate, source };
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
  const first = await fetchWithRetry(url, `[history ] ${ticker} page`, { headers: firstTrustHeaders() }, config.maxRetries);
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
    `[history ] ${ticker} xlsx`,
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
  return parseChart(await fetchJson(chartUrl(ticker, config), `[chart   ] ${ticker}`, yahooHeaders(), config));
}

/** SEC EDGAR N-PORT-P holdings for one fund (per-ticker trust resolution, JPMorgan helpers). */
async function fetchEdgarHoldings(fund: Fund, config: UpdaterConfig): Promise<{ rows: NportHolding[]; asOfDate: string | null; cik: string } | null> {
  if (!config.edgarFallback) return null;
  if (!config.secUa) {
    outputNote(`[ edgar    ] ${fund.ticker}: SEC fallback not attempted; configure SEC_UA with a valid organizational contact`);
    return null;
  }
  try {
    const filing = await resolveNportFiling(fund, config);
    if (!filing) return null;
    const parsed = parseNport(await fetchText(filing.accession.url, `[edgar   ] ${fund.ticker} N-PORT-P`, secHeaders(config), config));
    if (!parsed.holdings.length) return null;
    const rows = fillNportTickers(parsed.holdings, await loadCompanyTickerMap(config));
    return { rows, asOfDate: parsed.repPdDate || filing.accession.reportDate || null, cik: filing.cik };
  } catch (error) {
    outputNote(`[ edgar    ] ${fund.ticker}: ${errorMessage(error)}`);
    return null;
  }
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
  applySummary(fund, summary);
  const priorMeta = await readJson(new URL(`funds/${fund.ticker}/meta.json`, API_ROOT));
  const prior = isRecord(priorMeta) ? priorMeta : {};

  // Holdings: official HTML table -> SEC N-PORT-P -> previously published rows.
  let holdRows: JsonRecord[] = [];
  let holdingsAsOf: string | null = null;
  let holdingSource = 'First Trust official holdings page (ftportfolios.com EtfHoldings.aspx)';
  try {
    const holdings = parseHoldingsHtml(await fetchFirstTrustPage('EtfHoldings', fund.ticker, config));
    holdRows = holdings.rows;
    holdingsAsOf = holdings.asOfDate;
  } catch (error) {
    outputNote(`[ holdings ] ${fund.ticker}: ${errorMessage(error)}`);
  }
  if (!holdRows.length) {
    const sec = await fetchEdgarHoldings(fund, config);
    if (sec) {
      holdRows = sec.rows;
      holdingsAsOf = sec.asOfDate;
      holdingSource = `SEC EDGAR N-PORT-P (CIK ${sec.cik}; ${sec.asOfDate ?? 'report date unavailable'})`;
    }
  }
  if (!holdRows.length) {
    const previous = await previousRows(fund.ticker, 'holdings');
    if (previous.length) {
      holdRows = previous;
      holdingsAsOf = isRecord(prior.holdings) && typeof prior.holdings.asOfDate === 'string' ? prior.holdings.asOfDate : null;
      holdingSource = 'previously published First Trust holdings (retained because the current sources returned none)';
    }
  }

  // History: official XLSX export -> Yahoo market closes -> previously published rows.
  let historyRowsOut: SheetRow[] = [];
  let historySource = '';
  let historyAsOf: string | null = null;
  let officialHistoryCount: number | null = null;
  let yahooHistoryCount: number | null = null;
  try {
    const days = await fetchOfficialHistory(fund.ticker, config);
    if (days.length) {
      historyRowsOut = historySheetRows(days);
      historyAsOf = days.at(-1)?.date ?? null;
      officialHistoryCount = days.length;
      historySource = 'First Trust official daily NAV / market price history (ftportfolios.com EtfPriceHistory.aspx Excel export)';
    }
  } catch (error) {
    outputNote(`[ history  ] ${fund.ticker}: ${errorMessage(error)}`);
  }
  if (!historyRowsOut.length && !config.skipYahoo) {
    try {
      const chart = await fetchYahooChart(fund.ticker, config);
      if (chart.days.length) {
        historyRowsOut = historySheetRows(chart.days.map((day) => ({ date: day.date, nav: null, market: day.close, netAssets: null })));
        historyAsOf = chart.days.at(-1)?.date ?? null;
        yahooHistoryCount = chart.days.length;
        historySource = 'Yahoo Finance daily market-price chart (fallback; no NAV in this series)';
      }
    } catch (error) {
      outputNote(`[ chart    ] ${fund.ticker}: ${errorMessage(error)}`);
    }
  }
  if (!historyRowsOut.length) {
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
    outputNote(`[ history  ] ${fund.ticker} distributions: ${errorMessage(error)}`);
  }
  const distSummary = summarizeDistributions(distRows);

  const hManifest = await writePages(fund.ticker, 'holdings', HOLDINGS_HEADERS, holdRows, config.holdingsPageSize, holdingsAsOf, holdingSource);
  const yManifest = await writePages(fund.ticker, 'history', HISTORY_HEADERS, historyRowsOut, config.historyPageSize, historyAsOf, historySource);

  const pair = (...labels: string[]): SummaryPair | null => summaryValue(summary, ...labels);
  const nav = toNumber(pair('Closing NAV')?.value) ?? fund.navValue;
  const market = toNumber(pair('Closing Market Price')?.value);
  const premium = toNumber(pair('Bid/Ask Premium', 'Bid/Ask Premium/Discount')?.value);
  const aum = toNumber(pair('Total Net Assets', 'Net Assets')?.value) ?? fund.aumValue;
  const gross = toNumber(pair('Total Expense Ratio', 'Gross Expense Ratio', 'Expense Ratio')?.value) ?? fund.terValue;
  const net = toNumber(pair('Net Expense Ratio')?.value) ?? fund.netExpenseRatio;
  const ter = gross ?? net;
  const secYield = toNumber(pair('30-Day SEC Yield')?.value) ?? fund.secYield;
  const ratePair = pair('12-Month Distribution Rate');
  const rate12 = toNumber(ratePair?.value);
  const indicated = indicatedYield(distSummary.latest, PAYMENTS_PER_YEAR[distSummary.frequency ?? ''] ?? null, market);
  const dividendYield = rate12 ?? catalogRate ?? indicated;
  const navAsOf = summary.navAsOf ?? historyAsOf;
  const monthEnd = summary.monthEnd.asOfDate ? summary.monthEnd : fund.returns?.monthEnd ?? emptyReturns();
  const quarterEnd = summary.quarterEnd.asOfDate ? summary.quarterEnd : fund.returns?.quarterEnd ?? emptyReturns();
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
    inception: { fundInceptionDate: firstTrustIsoDate(pair('Inception')?.value) || fund.inceptionListed || null, exchange: pair('Exchange')?.value || null },
    expenseRatio: { display: formatPercent(ter), value: ter, gross, net, asOfDate: summary.expenseAsOf ?? pair('Total Expense Ratio')?.asOf ?? null },
    nav: { display: nav === null ? null : `$${nav.toFixed(2)}`, value: nav, asOfDate: navAsOf ? displayDate(navAsOf) : null },
    marketPrice: { display: market === null ? null : `$${market.toFixed(2)}`, value: market, asOfDate: navAsOf ? displayDate(navAsOf) : null },
    premiumDiscount: { display: formatPercent(premium), value: premium, basis: 'First Trust published bid/ask premium' },
    aum: { display: formatMoney(aum), value: aum, asOfDate: navAsOf ? displayDate(navAsOf) : null, source: 'First Trust fund summary (Total Net Assets)' },
    shares: { outstanding: toNumber(pair('Outstanding Shares')?.value) },
    yields: {
      dividendYield,
      dividendYieldText: dividendYield === null ? null : formatPercent(dividendYield),
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

// The First Trust ETF registrant CIK for a fund, needed only by the EDGAR
// fallback: the seed may pin it, otherwise it is read from the official SEC
// "ticker -> registrant CIK + series id" table and, as a last resort,
// discovered through the EDGAR full-text search API (cached per run).
const cikByTicker = new Map<string, string | null>();

// Lazily fetched, cached-per-run SEC lookup tables.
let fundTickerMap: Map<string, SecSeriesRef> | null = null;
let companyTickerMap: Map<string, string> | null = null;

async function loadFundTickerMap(config: UpdaterConfig): Promise<Map<string, SecSeriesRef>> {
  if (fundTickerMap) return fundTickerMap;
  try {
    const payload = await fetchJson(SEC_FUND_TICKERS_URL, '[edgar   ] fund ticker table', secHeaders(config), config);
    fundTickerMap = parseFundTickerMap(payload);
    outputNote(`[ edgar    ] SEC fund ticker table: ${fundTickerMap.size} ETF / mutual-fund share classes`);
  } catch (error) {
    console.warn(`[ edgar    ] fund ticker table: ${errorMessage(error)} — falling back to full-text search`);
    fundTickerMap = new Map<string, SecSeriesRef>();
  }
  return fundTickerMap;
}

async function loadCompanyTickerMap(config: UpdaterConfig): Promise<Map<string, string>> {
  if (companyTickerMap) return companyTickerMap;
  try {
    const payload = await fetchJson(SEC_COMPANY_TICKERS_URL, '[ edgar    ] company ticker table', secHeaders(config), config);
    companyTickerMap = parseCompanyTickerMap(payload);
    outputNote(`[ edgar    ] SEC company ticker table: ${companyTickerMap.size} issuer names`);
  } catch (error) {
    console.warn(`[ edgar    ] company ticker table: ${errorMessage(error)} — N-PORT tickers stay "-"`);
    companyTickerMap = new Map<string, string>();
  }
  return companyTickerMap;
}

// N-PORT positions carry CUSIP/ISIN but never a ticker; the SEC company table
// turns the filed issuer name back into an exchange symbol so the watchlist
// export stays usable, exactly like the sibling Fidelity updater.
function fillNportTickers(rows: NportHolding[], names: Map<string, string>): NportHolding[] {
  if (!names.size) return rows;
  return rows.map((row) => {
    if (cleanHoldingTicker(row.Ticker)) return row;
    const name = String(row.Name ?? '');
    const ticker = names.get(normalizeHoldingName(name)) || names.get(normalizeHoldingNameCore(name)) || '';
    return ticker ? { ...row, Ticker: ticker } : row;
  });
}

async function resolveRegistrantCik(fund: CatalogFund, config: UpdaterConfig): Promise<string | null> {
  if (cikByTicker.has(fund.ticker)) return cikByTicker.get(fund.ticker) as string | null;
  let cik: string | null = fund.trustCik || null;
  if (!cik) {
    const table = await loadFundTickerMap(config);
    cik = table.get(fund.ticker)?.cik || null;
  }
  if (!cik) {
    try {
      const payload = await fetchJson(eftsSearchUrl(fund.ticker), `[edgar   ] search ${fund.ticker}`, secHeaders(config), config);
      cik = pickEftsCik(payload, fund.name);
    } catch (error) {
      outputNote(`[ edgar    ] search ${fund.ticker}: ${errorMessage(error)}`);
    }
  }
  cikByTicker.set(fund.ticker, cik);
  return cik;
}

// The fund's own newest N-PORT-P filing. The SEC series id gives an exact,
// one-request answer (browse-edgar Atom, filtered to that series); scanning the
// whole registrant's submissions is the fallback when the series is unknown.
async function resolveNportFiling(
  fund: CatalogFund,
  config: UpdaterConfig,
): Promise<{ accession: NportAccession; cik: string; seriesId: string } | null> {
  const table = await loadFundTickerMap(config);
  const ref = table.get(fund.ticker) || null;
  if (ref?.seriesId) {
    try {
      const atom = await fetchText(edgarSeriesFilingsUrl(ref.seriesId), `[edgar   ] ${fund.ticker} series ${ref.seriesId}`, secHeaders(config), config);
      const [newest] = parseEdgarAtomFilings(atom);
      if (newest) return { accession: newest, cik: ref.cik, seriesId: ref.seriesId };
    } catch (error) {
      outputNote(`[ edgar    ] ${fund.ticker} series ${ref.seriesId}: ${errorMessage(error)} — scanning registrant submissions`);
    }
  }
  const cik = ref?.cik || (await resolveRegistrantCik(fund, config));
  if (!cik) return null;
  try {
    const submissions = await fetchJson(`${SEC_DATA_HOST}/submissions/CIK${cik}.json`, `[edgar   ] ${cik} submissions`, secHeaders(config), config);
    const [newest] = parseNportAccessions(submissions);
    if (newest) return { accession: newest, cik, seriesId: ref?.seriesId || '' };
  } catch (error) {
    outputNote(`[ edgar    ] ${fund.ticker}: ${errorMessage(error)}`);
  }
  return null;
}
// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const controls = await runtimeControls();
  installSystemCa(controls.USE_SYSTEM_CA ?? 'auto');
  if (controls.VERBOSE !== undefined) process.env.VERBOSE = controls.VERBOSE;
  const config = readConfig(controls);
  configureRequestLanes(config.concurrency, config.requestSleep);

  outputPrintConfig('First Trust', config);
  console.log('');

  // 1) Catalog discovery: official ETF list (+ NAV performance view), previous index.
  const previousIndex = await readPreviousIndex();
  let catalog: Fund[] = [];
  let catalogSource = 'previous api/firsttrust/index.json';
  let live = false;
  try {
    catalog = parseCatalogHtml(await fetchText(FIRSTTRUST_ETF_LIST, '[catalog ] ETF list', firstTrustHeaders(), config));
    if (!catalog.length) throw new Error('official ETF list contained no funds');
    live = true;
    catalogSource = 'ftportfolios.com official ETF list';
  } catch (error) {
    console.warn(`[ catalog  ] ${errorMessage(error)} — falling back to the published feed`);
  }
  if (live) {
    try {
      const performance = parsePerformanceNavHtml(await fetchText(FIRSTTRUST_PERFORMANCE_LIST, '[catalog ] NAV performance view', firstTrustHeaders(), config));
      for (const fund of catalog) applyCatalogPerformance(fund, performance.get(fund.ticker));
      catalogSource += ` + NAV performance view (${performance.size} funds)`;
    } catch (error) {
      console.warn(`[ catalog  ] NAV performance view: ${errorMessage(error)} — TER and returns come from the fund pages`);
    }
    const known = new Set(catalog.map((fund) => fund.ticker));
    for (const item of previousIndex.values()) if (!known.has(String(item.ticker))) catalog.push(cachedFundFromIndex(item));
    catalog.sort((a, b) => a.ticker.localeCompare(b.ticker));
  } else {
    catalog = [...previousIndex.values()].map(cachedFundFromIndex).filter((fund) => Boolean(fund.ticker));
  }
  if (!catalog.length) throw new Error('No current or previously published First Trust catalog is available');
  for (const fund of catalog) mergePrevious(fund, previousIndex.get(fund.ticker));
  console.log(`[ catalog  ] ${catalog.length} First Trust ETFs (${catalogSource})`);

  // 2) Filters: TICKERS allowlist, then the data filters on catalog values.
  const requested = new Set(config.tickers);
  if (requested.size) {
    const missing = config.tickers.filter((ticker) => !catalog.some((fund) => fund.ticker === ticker));
    if (missing.length) throw new Error(`Requested ticker(s) not in the First Trust catalog: ${missing.join(', ')}`);
  }
  const candidates = requested.size ? catalog.filter((fund) => requested.has(fund.ticker)) : catalog;
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
    const filtered = config.tickers.filter((ticker) => !universe.some((fund) => fund.ticker === ticker));
    if (filtered.length) throw new Error(`Requested ticker(s) were excluded by configured filters: ${filtered.join(', ')}`);
  }

  // 3) Bounded, resumable batch run (JPMorgan/iShares cursor semantics).
  const state = await readUpdateState();
  const cursor = config.maxFetches > 0 ? state?.cursor || null : null;
  const cursorIndex = cursor ? universe.findIndex((fund) => fund.ticker === cursor) : -1;
  const ordered = cursorIndex >= 0 ? universe.slice(cursorIndex + 1).concat(universe.slice(0, cursorIndex + 1)) : universe.slice();
  const queue = ordered.slice();
  const results = new Map<string, JsonRecord>();
  let processed = 0;
  let lastProcessedTicker: string | null = cursor;
  let failures = 0;

  const output = outputCreateReporter(API_ROOT, config.maxFetches > 0 ? Math.min(config.maxFetches, ordered.length) : ordered.length);
  async function worker(): Promise<void> {
    for (;;) {
      const fund = queue.shift();
      if (!fund) return;
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

  // 4) Index: fresh rows, previously published rows, catalog-only rows for never-fetched funds.
  const published = await publishedFundTickers();
  let keptFromPrevious = 0;
  const funds: JsonRecord[] = [];
  for (const fund of catalog) {
    const fresh = results.get(fund.ticker);
    const previous = previousIndex.get(fund.ticker);
    if (fresh) funds.push(fresh);
    else if (previous && (published.has(fund.ticker) || !live)) {
      funds.push(previous);
      keptFromPrevious += 1;
    } else funds.push(catalogOnlyEntry(fund));
  }
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
    funds,
  });

  // Full passes reset the cursor: the next run starts from the top again.
  await writeUpdateState(config.maxFetches > 0 ? lastProcessedTicker : null);

  console.log('');
  console.log(`[ done     ] ${results.size} funds updated, ${keptFromPrevious} kept from previous runs, ${failures} failures`);
  console.log(`[ done     ] counts: ${counts.funds} funds / ${counts.holdings.toLocaleString('en-US')} holdings rows / ${counts.history.toLocaleString('en-US')} history rows`);
  console.log(`[ cursor   ] ${config.maxFetches > 0 && lastProcessedTicker ? `next run continues after ${lastProcessedTicker}` : 'full pass complete (cursor reset)'}`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `### First Trust data update\n\n- updated: ${results.size}\n- kept from previous runs: ${keptFromPrevious}\n- failed: ${failures}\n- counts: ${counts.funds} funds / ${counts.holdings.toLocaleString('en-US')} holdings rows / ${counts.history.toLocaleString('en-US')} history rows\n`,
      'utf8',
    );
  }
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
    await main().catch((error) => {
      console.error(error instanceof Error ? error.stack : String(error));
      process.exitCode = 1;
    });
  }
}
