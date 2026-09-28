#!/usr/bin/env bun
/// <reference types="bun" />
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';


/**
 * First Trust static data updater. Bun only, zero runtime dependencies.
 * Official ftportfolios.com ETF list, fund summary, holdings, distribution history and
 * price-history XLSX export; Yahoo Finance (history fallback) and SEC EDGAR N-PORT-P (holdings fallback).
 */

type JsonRecord = Record<string, unknown>;
type Range = { min?: number; max?: number; source: string };
type Fund = JsonRecord & {
  ticker: string; name: string; category: string; navValue: number | null; aumValue: number | null;
  terValue: number | null; dividendYield: number | null; secYield: number | null;
};
type Config = {
  maxFetches: number; requestSleep: number; concurrency: number; maxRetries: number;
  holdingsPageSize: number; historyPageSize: number; historyRange: string; tickers: Set<string>;
  aum: Range; ter: Range; dividendYield: Range; secYield: Range;
  performance: Record<string, Range>; totalReturn: Record<string, Range>;
  edgarFallback: boolean; skipYahoo: boolean; secUa: string;
};
type SheetRow = Record<string, string>;
type ChartDay = { date: string; close: number | null; adjClose: number | null; dividend: number | null };
type PriceDay = { date: string; nav: number | null; market: number | null; netAssets: number | null };
type PageManifest = { pages: string[]; pageSize: number; totalRows: number; asOfDate: string | null; source: string };
type FundSnapshot = { digest: string; meta: JsonRecord };
type ReturnRow = { asOfDate: string | null; mo3: number | null; ytd: number | null; yr1: number | null; yr3: number | null; yr5: number | null; yr10: number | null; sinceInception: number | null };
type SummaryPair = { value: string; asOf: string | null };
type Summary = {
  name: string | null; pairs: Record<string, SummaryPair>; navAsOf: string | null; expenseAsOf: string | null; benchmark: string | null;
  monthEnd: ReturnRow; quarterEnd: ReturnRow;
};
type Distributions = { headers: string[]; rows: string[][]; years: number[]; selectedYear: number | null };

const ISSUER_SITE = 'https://www.ftportfolios.com';
const ISSUER_LIST_PAGE = 'https://www.ftportfolios.com/Retail/etf/etflist.aspx';
const ISSUER_HOME = 'https://www.ftportfolios.com/retail/etf/home.aspx';
const ETF_PATH = `${ISSUER_SITE}/Retail/Etf`;
const SEC_MF_TICKERS = 'https://www.sec.gov/files/company_tickers_mf.json';
const SEC_ARCHIVES = 'https://www.sec.gov/Archives/edgar/data';
const SEC_BROWSE = 'https://www.sec.gov/cgi-bin/browse-edgar';
const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';
const API_ROOT = new URL('../api/firsttrust/', import.meta.url);
const INDEX_FILE = new URL('index.json', API_ROOT);
const STATE_FILE = new URL('update-state.json', API_ROOT);
export const HOLDINGS_HEADERS = ['Name', 'Ticker', 'Identifier', 'Weight', 'Market Value', 'Shares Held', 'Asset Category'];
export const HISTORY_HEADERS = ['Date', 'NAV', 'Market Price', 'Premium/Discount', 'Total Net Assets'];
export const DISTRIBUTION_HEADERS = ['Ex-Date', 'Record Date', 'Payable Date', 'Distribution Amount', 'Distribution Type'];
const RETURN_PERIODS = ['YTD', '1Y', '3Y', '5Y', '10Y'];
const DEFAULTS = { requestSleep: 1, concurrency: 2, maxRetries: 2, holdingsPageSize: 250, historyPageSize: 1000 };
const PROVIDER = 'First Trust Portfolios L.P. / First Trust Advisors L.P. official ftportfolios.com pages + Yahoo Finance chart (history fallback) + SEC EDGAR N-PORT-P (holdings fallback only)';
const SEC_TRUSTS = 'First Trust Exchange-Traded Fund trusts (e.g. CIK 0001329377, AlphaDEX CIK 0001383496); CIK resolved per ticker from SEC company_tickers_mf.json';

// Shared console contract (kept intentionally simple and stable).
const outputClean = (value: unknown): string => String(value ?? 'null').replace(/[\r\n\t]+/g, ' ');
const outputVerbose = (): boolean => /^(1|true|yes|on)$/i.test(process.env.VERBOSE ?? '');
function outputNote(message: string): void { if (outputVerbose()) console.warn(message); }
function outputCount(value: unknown): unknown {
  return typeof value === 'number' ? value : Array.isArray(value) ? value.length : null;
}
function outputMoney(value: unknown): string {
  const number = toNumber(value);
  if (number === null) return 'null';
  for (const [suffix, scale] of [['T', 1e12], ['B', 1e9], ['M', 1e6], ['K', 1e3]] as const) {
    if (Math.abs(number) >= scale) return `$${(number / scale).toFixed(1)}${suffix}`;
  }
  return `$${number.toFixed(2)}`;
}
function outputStable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(outputStable);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().filter(key => !['generatedAt', 'catalogReadAt'].includes(key)).map(key => [key, outputStable(value[key])]));
}
export function outputContentKey(value: unknown): string { return JSON.stringify(outputStable(value)) ?? 'null'; }
async function outputInspectFund(ticker: string): Promise<FundSnapshot> {
  const dir = new URL(`funds/${ticker}/`, API_ROOT);
  const digest = createHash('sha256');
  async function visit(path: URL): Promise<void> {
    const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = new URL(entry.name, path);
      if (entry.isDirectory()) await visit(new URL(`${entry.name}/`, path));
      else if (entry.name.endsWith('.json')) {
        const text = await readFile(child, 'utf8').catch(() => '');
        digest.update(entry.name);
        try { digest.update(outputContentKey(JSON.parse(text))); } catch { digest.update(text); }
      }
    }
  }
  await visit(dir);
  const meta = await readJson(new URL('meta.json', dir));
  return { digest: digest.digest('hex'), meta: isRecord(meta) ? meta : {} };
}
export function outputFundLine(index: number, total: number, ticker: string, status: string, meta: JsonRecord, reason = ''): string {
  const num = (key: string, value: unknown): string => value === null || value === undefined || value === 'null' ? '' : `${key}=${outputClean(value)}`;
  const line = [
    num('history', outputCount(meta.historyCount)), num('holdings', outputCount(meta.holdingsCount)),
    num('divs', outputCount(meta.distributionCount)), num('netAssets', meta.netAssets === null || meta.netAssets === undefined ? null : outputMoney(meta.netAssets)),
    num('div', meta.dividendYield), num('sec', meta.secYield),
  ].filter(Boolean).join(' ');
  return `[ ${String(index).padStart(Math.max(2, String(total).length))}/${String(total).padEnd(Math.max(2, String(total).length))}  ] ${ticker.padEnd(5)} ${status.padEnd(9)}${line ? ` ${line}` : ''}${reason ? ` reason=${outputClean(reason)}` : ''}`;
}
function outputCreateReporter(total: number) {
  let completed = 0, failures = 0, updated = 0, unchanged = 0;
  return {
    async result(ticker: string, before: FundSnapshot, meta: JsonRecord, status?: string, reason = ''): Promise<void> {
      const after = await outputInspectFund(ticker);
      const detected = before.digest === after.digest ? 'unchanged' : 'updated';
      const finalStatus = status ?? detected;
      if (finalStatus === 'failed') failures++;
      else if (finalStatus === 'updated') updated++;
      else unchanged++;
      console.log(outputFundLine(++completed, total, ticker, finalStatus, meta, reason));
    },
    summary: () => ({ completed, failures, updated, unchanged }),
  };
}
function outputPrintConfig(config: Config): void {
  const entries: [string, string][] = [
    ['MAX_FETCHES', String(config.maxFetches)], ['REQUEST_SLEEP', String(config.requestSleep)], ['CONCURRENCY', String(config.concurrency)],
    ['AUM', config.aum.source], ['DIVIDEND_YIELD', config.dividendYield.source], ['EDGAR_FALLBACK', String(config.edgarFallback)],
    ['HISTORY_PAGE_SIZE', String(config.historyPageSize)], ['HISTORY_RANGE', config.historyRange], ['HOLDINGS_PAGE_SIZE', String(config.holdingsPageSize)],
    ['MAX_RETRIES', String(config.maxRetries)], ['SEC_UA', config.secUa ? '<configured>' : '<not configured>'],
    ['SEC_YIELD', config.secYield.source], ['SKIP_YAHOO', String(config.skipYahoo)],
    ['TER', config.ter.source], ['TICKERS', [...config.tickers].join(',') || 'all'], ['VERBOSE', String(outputVerbose())],
    ...RETURN_PERIODS.map(period => [`PERFORMANCE_${period}`, config.performance[period].source] as [string, string]),
    ...RETURN_PERIODS.map(period => [`TOTAL_RETURN_${period}`, config.totalReturn[period].source] as [string, string]),
  ];
  const first = ['MAX_FETCHES', 'REQUEST_SLEEP', 'CONCURRENCY'];
  entries.sort(([a], [b]) => {
    const ai = first.indexOf(a), bi = first.indexOf(b);
    return (ai < 0 ? first.length : ai) - (bi < 0 ? first.length : bi) || a.localeCompare(b);
  });
  console.log(`[ config   ] First Trust updater:\n${entries.map(([key, value]) => `              ${key}=${outputClean(value)}`).join('\n')}`);
}
function outputPrintFilter(selected: number, total: number, deferred = false): void {
  console.log(`[ filter   ] ${selected} of ${total} funds ${deferred ? 'selected for evaluation (data-dependent filters applied per fund)' : 'pass filters'}`);
}

function isRecord(value: unknown): value is JsonRecord { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
export function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&reg;|&#174;/gi, '\u00ae').replace(/&trade;|&#8482;/gi, '\u2122')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&amp;/gi, '&');
}
function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\u00ae|\u2122|\u2120/g, '').replace(/\s+/g, ' ').trim();
}
/** Visible text of an HTML fragment: drops comments, <sup> footnote markers and tags, decodes entities. */
export function htmlText(fragment: string): string {
  return cleanText(decodeEntities(String(fragment)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')));
}
function stripComments(html: string): string { return String(html).replace(/<!--[\s\S]*?-->/g, ' '); }
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(/[,$%\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!text || /^(n\/?a|none|null|unknown|-+)$/i.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}
export function toIsoDate(value: unknown): string {
  const text = String(value ?? '').trim();
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  if (us) {
    const year = us[3].length === 2 ? `${Number(us[3]) >= 70 ? '19' : '20'}${us[3]}` : us[3];
    return `${year}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  }
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  return text;
}
function displayDate(value: unknown): string {
  const iso = toIsoDate(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(match[2])-1]} ${match[3]} ${match[1]}` : iso;
}
function tickerClean(value: unknown): string { return String(value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase(); }
function formatMoney(value: number | null): string {
  if (value === null) return '—';
  for (const [unit, scale] of [['T',1e12],['B',1e9],['M',1e6],['K',1e3]] as const) if (Math.abs(value) >= scale) return `$${(value/scale).toFixed(2)}${unit}`;
  return `$${value.toFixed(2)}`;
}
function formatPercent(value: number | null): string { return value === null ? '—' : `${value.toFixed(2)}%`; }
function numberText(value: unknown): string { const n = toNumber(value); return n === null ? '' : String(n); }
function round(value: number, digits: number): number { const scale = 10 ** digits; return Math.round((value + Number.EPSILON) * scale) / scale; }

export function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}
export function parseDecimal(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
export function parseRange(value: string | undefined, name = 'range'): Range {
  const source = value?.trim() || ':';
  if (source === ':' || source === '') return { source: ':' };
  if (!source.includes(':')) throw new Error(`${name} must be MIN:MAX (colon required)`);
  const [lo, hi, ...extra] = source.split(':');
  if (extra.length) throw new Error(`${name} has too many ':' separators`);
  const parse = (raw: string): number | undefined => {
    if (!raw.trim()) return undefined;
    const n = toNumber(raw);
    if (n === null) throw new Error(`${name} bound is not numeric`);
    return n;
  };
  const min = parse(lo), max = parse(hi);
  if (min !== undefined && max !== undefined && min > max) throw new Error(`${name} minimum exceeds maximum`);
  return { min, max, source };
}
export function parseAumRange(value: string | undefined): Range {
  const raw = value?.trim() || ':';
  const presets: Record<string, string> = {
    nano: ':10M', micro: '10M:300M', small: '300M:2B', mid: '2B:10B', large: '10B:',
  };
  if (presets[raw.toLowerCase()]) return parseAumRange(presets[raw.toLowerCase()]);
  if (raw === ':') return { source: ':' };
  if (!raw.includes(':')) throw new Error('AUM must be MIN:MAX (colon required) or nano/micro/small/mid/large');
  const [lo, hi, ...extra] = raw.split(':');
  if (extra.length) throw new Error('AUM has too many separators');
  const parse = (part: string): string => {
    const text = part.trim();
    if (!text) return '';
    const m = /^([\d,.]+)\s*([KMBT])?$/i.exec(text);
    if (!m) throw new Error(`AUM bound is invalid: ${text}`);
    const amount = Number(m[1].replace(/,/g, '')) * ({ K:1e3, M:1e6, B:1e9, T:1e12 }[String(m[2] || '').toUpperCase() as 'K'|'M'|'B'|'T'] ?? 1);
    return String(amount);
  };
  const parsed = parseRange(`${parse(lo)}:${parse(hi)}`, 'AUM');
  return { ...parsed, source: raw };
}
function isActive(range: Range): boolean { return range.min !== undefined || range.max !== undefined; }
function inRange(value: number | null, range: Range): boolean {
  return value === null ? !isActive(range) : (range.min === undefined || value >= range.min) && (range.max === undefined || value <= range.max);
}
export function readConfig(env: Record<string, string | undefined> = process.env): Config {
  const performance: Record<string, Range> = {}, totalReturn: Record<string, Range> = {};
  for (const period of RETURN_PERIODS) {
    performance[period] = parseRange(env[`PERFORMANCE_${period}`], `PERFORMANCE_${period}`);
    totalReturn[period] = parseRange(env[`TOTAL_RETURN_${period}`], `TOTAL_RETURN_${period}`);
  }
  const tickers = new Set((env.TICKERS ?? '').split(/[\s,]+/).map(tickerClean).filter(Boolean));
  const range = (key: string): Range => parseRange(env[key], key);
  return {
    maxFetches: parsePositiveInt(env.MAX_FETCHES, 0), requestSleep: parseDecimal(env.REQUEST_SLEEP, DEFAULTS.requestSleep),
    concurrency: Math.max(1, parsePositiveInt(env.CONCURRENCY, DEFAULTS.concurrency)), maxRetries: parsePositiveInt(env.MAX_RETRIES, DEFAULTS.maxRetries),
    holdingsPageSize: Math.max(1, parsePositiveInt(env.HOLDINGS_PAGE_SIZE, DEFAULTS.holdingsPageSize)),
    historyPageSize: Math.max(1, parsePositiveInt(env.HISTORY_PAGE_SIZE, DEFAULTS.historyPageSize)),
    historyRange: env.HISTORY_RANGE?.trim() || 'max', tickers, aum: parseAumRange(env.AUM), ter: range('TER'),
    dividendYield: range('DIVIDEND_YIELD'), secYield: range('SEC_YIELD'), performance, totalReturn,
    edgarFallback: !/^(0|false|no|off)$/i.test(env.EDGAR_FALLBACK ?? '1'),
    skipYahoo: /^(1|true|yes|on)$/i.test(env.SKIP_YAHOO ?? ''),
    secUa: env.SEC_UA?.trim() ?? '',
  };
}

// =========================================================================
// Official ftportfolios.com parsers (server-rendered ASP.NET HTML + XLSX export)
// =========================================================================

/** Splits an HTML table into rows of visible cell texts (th and td). */
export function tableRows(tableHtml: string): string[][] {
  const rows: string[][] = [];
  for (const row of stripComments(tableHtml).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => htmlText(cell[1]));
    if (cells.length) rows.push(cells);
  }
  return rows;
}
function tablesByClass(html: string, className: string): string[] {
  const result: string[] = [];
  const pattern = new RegExp(`<table\\b[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/table>`, 'gi');
  for (const match of stripComments(html).matchAll(pattern)) result.push(match[0]);
  return result;
}
function categoryLabel(sectionTitle: string): string {
  const text = cleanText(decodeEntities(sectionTitle));
  return text.replace(/\s+Funds$/i, '') || 'Uncategorized';
}

/** Official ETF list: one section per category, each row links to EtfSummary.aspx?Ticker=… */
export function parseCatalogHtml(html: string): Fund[] {
  const body = stripComments(html);
  const parts = body.split(/lblETFSectionTitle"[^>]*>([^<]*)</);
  const byTicker = new Map<string, Fund>();
  for (let i = 1; i < parts.length; i += 2) {
    const category = categoryLabel(parts[i]);
    for (const row of parts[i + 1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const link = /EtfSummary\.aspx\?Ticker=([A-Za-z0-9]+)['"][^>]*>([\s\S]*?)<\/a>/i.exec(row[1]);
      if (!link) continue;
      const ticker = tickerClean(link[1]);
      const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => htmlText(cell[1]));
      const name = cleanText(htmlText(link[2]));
      if (!ticker || !name || byTicker.has(ticker)) continue;
      const [, , inception, nav, secYield, unsubsidized, distributionRate, yieldAsOf] = cells;
      byTicker.set(ticker, {
        ticker, name, category,
        navValue: toNumber(nav), aumValue: null, terValue: null,
        dividendYield: toNumber(distributionRate), secYield: toNumber(secYield),
        inceptionListed: toIsoDate(inception) || null,
        unsubsidizedSecYield: toNumber(unsubsidized),
        yieldAsOf: toIsoDate(yieldAsOf) || null,
      });
    }
  }
  return [...byTicker.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
}

function emptyReturns(): ReturnRow {
  return { asOfDate: null, mo3: null, ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null };
}
function asOfFrom(text: string): string | null {
  const match = /\(as of (\d{1,2}\/\d{1,2}\/\d{4})\)/i.exec(text);
  return match ? toIsoDate(match[1]) : null;
}
function parseReturnBlock(html: string, title: string): ReturnRow {
  const result = emptyReturns();
  const titleMatch = new RegExp(`${title} Performance\\s*\\(as of (\\d{1,2}/\\d{1,2}/\\d{4})\\)`, 'i').exec(html);
  if (!titleMatch) return result;
  result.asOfDate = toIsoDate(titleMatch[1]);
  const after = html.slice(titleMatch.index);
  const table = /<table\b[^>]*class="[^"]*\bfundGrid\b[^"]*"[^>]*>[\s\S]*?<\/table>/i.exec(after)?.[0];
  if (!table) return result;
  const rows = tableRows(table);
  const header = rows[0] ?? [];
  const navRow = rows.find(row => /^Net Asset Value \(NAV\)$/i.test(row[0] ?? ''));
  if (!navRow) return result;
  const slot = (label: string): keyof Omit<ReturnRow, 'asOfDate'> | null => {
    const text = label.toLowerCase().replace(/\s+/g, ' ').trim();
    if (text === '3 month') return 'mo3';
    if (text === 'ytd') return 'ytd';
    if (text === '1 year') return 'yr1';
    if (text === '3 year') return 'yr3';
    if (text === '5 year') return 'yr5';
    if (text === '10 year') return 'yr10';
    if (text.startsWith('since')) return 'sinceInception';
    return null;
  };
  header.forEach((label, index) => {
    const key = slot(label);
    if (key && index < navRow.length) result[key] = toNumber(navRow[index]);
  });
  return result;
}

/** Fund summary page: name/value pairs (with as-of dates) and the NAV performance rows. */
export function parseSummaryHtml(html: string): Summary {
  const body = stripComments(html);
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
    name, pairs, navAsOf: navHeader ? toIsoDate(navHeader[1]) : null, expenseAsOf: expenseDate ? toIsoDate(expenseDate[1]) : null,
    monthEnd: parseReturnBlock(body, 'Month End'), quarterEnd: parseReturnBlock(body, 'Quarter End'),
  };
}
export function summaryValue(summary: Summary, ...labels: string[]): SummaryPair | null {
  for (const label of labels) {
    const want = label.toLowerCase();
    for (const [key, pair] of Object.entries(summary.pairs)) if (key.toLowerCase() === want) return pair;
  }
  return null;
}

function isExchangeTicker(value: string): boolean { return /^[A-Z0-9][A-Z0-9./-]{0,14}$/.test(value) && /[A-Z]/.test(value); }
/** Official holdings table (fundSilverGrid with a "Security Name" header). Column set varies by fund. */
export function parseHoldingsHtml(html: string): { headers: string[]; rows: SheetRow[]; asOfDate: string | null } {
  const asOf = /Holdings of the Fund as of\s*(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(htmlText(html));
  const rows: SheetRow[] = [];
  for (const table of tablesByClass(html, 'fundSilverGrid')) {
    const cells = tableRows(table);
    const header = cells[0] ?? [];
    const col = (name: string): number => header.findIndex(label => label.toLowerCase() === name.toLowerCase());
    const nameAt = col('Security Name'), weightAt = col('Weighting');
    if (nameAt < 0 || weightAt < 0) continue;
    const idAt = col('Identifier'), cusipAt = col('CUSIP'), classAt = col('Classification');
    const qtyAt = col('Shares / Quantity'), valueAt = col('Market Value');
    for (const row of cells.slice(1)) {
      const name = row[nameAt] ?? '';
      if (!name) continue;
      const rawId = (idAt >= 0 ? row[idAt] ?? '' : '').replace(/\s+/g, ' ').trim();
      const cusip = (cusipAt >= 0 ? row[cusipAt] ?? '' : '').trim();
      const ticker = rawId && rawId !== cusip && isExchangeTicker(rawId) ? rawId : '';
      rows.push({
        Name: name, Ticker: ticker || '-', Identifier: cusip || (ticker ? '' : rawId) || '-',
        Weight: numberText(row[weightAt]) || '0', 'Market Value': numberText(valueAt >= 0 ? row[valueAt] : '') || '0',
        'Shares Held': numberText(qtyAt >= 0 ? row[qtyAt] : '') || '-', 'Asset Category': (classAt >= 0 ? row[classAt] : '') || '-',
      });
    }
  }
  for (const row of rows) if (!row.Identifier) row.Identifier = '-';
  return { headers: HOLDINGS_HEADERS, rows, asOfDate: asOf ? toIsoDate(asOf[1]) : null };
}

/** Distribution history page (one calendar year per page); the dropdown lists the years that have distributions. */
export function parseDistributionHtml(html: string): Distributions {
  const body = stripComments(html);
  const select = /<select\b[^>]*ddlDistributionHistoryYearSelection[^>]*>([\s\S]*?)<\/select>/i.exec(body)?.[1] ?? '';
  const years = [...select.matchAll(/<option\b[^>]*value="(\d{4})"/gi)].map(match => Number(match[1])).sort((a, b) => a - b);
  const selectedMatch = /<option\b[^>]*selected="selected"[^>]*value="(\d{4})"/i.exec(select);
  const rows: string[][] = [];
  for (const table of tablesByClass(body, 'fundSilverGrid')) {
    const cells = tableRows(table);
    const header = (cells[0] ?? []).map(label => label.toLowerCase());
    const at = (name: string): number => header.indexOf(name.toLowerCase());
    const exAt = at('Ex-Date');
    if (exAt < 0) continue;
    const recordAt = at('Record Date'), payAt = at('Payable Date'), amountAt = at('Distribution Amount'), typeAt = at('Distribution Type');
    for (const row of cells.slice(1)) {
      const ex = toIsoDate(row[exAt]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ex)) continue;
      const amount = toNumber(amountAt >= 0 ? row[amountAt] : null);
      rows.push([ex, toIsoDate(recordAt >= 0 ? row[recordAt] : ''), toIsoDate(payAt >= 0 ? row[payAt] : ''), amount === null ? '' : amount.toFixed(6), (typeAt >= 0 ? row[typeAt] : '') || '']);
    }
  }
  return { headers: DISTRIBUTION_HEADERS, rows, years, selectedYear: selectedMatch ? Number(selectedMatch[1]) : (years.at(-1) ?? null) };
}
/** Newest first, de-duplicated. Rows from freshly fetched years replace previously published rows of those years. */
export function mergeDistributionRows(fresh: string[][], previous: string[][], freshYears: Set<number>): string[][] {
  const kept = previous.filter(row => !freshYears.has(Number(String(row[0]).slice(0, 4))));
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
  const dates = [...new Set(isoDates.filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value)))].sort();
  if (dates.length < 2) return null;
  const gaps = dates.slice(1).map((date, i) => (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${dates[i]}T00:00:00Z`)) / 86400000).filter(n => n > 0);
  if (!gaps.length) return null;
  const avg = gaps.reduce((sum, n) => sum + n, 0) / gaps.length;
  if (avg <= 45) return 'Monthly';
  if (avg <= 115) return 'Quarterly';
  if (avg <= 220) return 'Semi-annually';
  if (avg <= 400) return 'Annually';
  return 'Irregular';
}
/** Cadence from the latest year of ordinary distributions; latest ordinary amount and ex-date. */
export function summarizeDistributions(rows: string[][], today = new Date()): { frequency: string | null; latest: number | null; exDate: string | null } {
  const ordinary = rows.filter(row => !/capital gain|return of capital/i.test(row[4] ?? '') && toNumber(row[3]) !== null);
  const sorted = [...ordinary].sort((a, b) => b[0].localeCompare(a[0]));
  const latest = sorted[0];
  if (!latest) return { frequency: null, latest: null, exDate: null };
  const newest = Date.parse(`${latest[0]}T00:00:00Z`);
  const recent = sorted.filter(row => newest - Date.parse(`${row[0]}T00:00:00Z`) <= 400 * 86400000).map(row => row[0]);
  const stale = today.getTime() - newest > 400 * 86400000;
  const frequency = stale ? null : inferFrequency(recent) ?? (recent.length === 1 ? 'Annually' : null);
  return { frequency, latest: toNumber(latest[3]), exDate: latest[0] };
}

export function parseHiddenInputs(html: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/type="hidden"/i.test(tag)) continue;
    const name = /name="([^"]+)"/i.exec(tag)?.[1];
    if (!name) continue;
    result[decodeEntities(name)] = decodeEntities(/value="([^"]*)"/i.exec(tag)?.[1] ?? '');
  }
  return result;
}

/** Minimal zero-dependency XLSX reader: first worksheet as a row-major string grid. */
export function readXlsxRows(data: Uint8Array): string[][] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('XLSX: end of central directory not found');
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const files = new Map<string, string>();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('XLSX: bad central directory entry');
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true), commentLength = view.getUint16(offset + 32, true);
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
  const xmlText = (value: string): string => decodeEntities(value.replace(/<[^>]+>/g, ''));
  const shared = [...(files.get('xl/sharedStrings.xml') ?? '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)]
    .map(match => [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map(part => xmlText(part[1])).join(''));
  const sheetName = [...files.keys()].filter(name => name.startsWith('xl/worksheets/')).sort()[0];
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
      else if (type === 'inlineStr') text = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map(part => xmlText(part[1])).join('');
      else text = xmlText(value);
      while (cells.length < column) cells.push('');
      cells[column] = text.trim();
    }
    rows.push(cells);
  }
  return rows;
}
/** Official "Export Prices to Excel" grid: Date | Market Price | Net Asset Value | Bid/Ask Midpoint | Volume | Net Assets. */
export function parsePriceHistoryRows(grid: string[][]): PriceDay[] {
  const headerIndex = grid.findIndex(row => row.some(cell => /^date$/i.test(cell)) && row.some(cell => /net asset value/i.test(cell)));
  if (headerIndex < 0) return [];
  const header = grid[headerIndex].map(cell => cell.toLowerCase());
  const at = (pattern: RegExp): number => header.findIndex(cell => pattern.test(cell));
  const dateAt = at(/^date$/), marketAt = at(/^market price/), navAt = at(/^net asset value/), assetsAt = at(/^net assets/);
  const byDate = new Map<string, PriceDay>();
  for (const row of grid.slice(headerIndex + 1)) {
    const raw = row[dateAt] ?? '';
    const serial = /^\d{5}(\.\d+)?$/.test(raw) ? new Date(Date.UTC(1899, 11, 30) + Math.round(Number(raw)) * 86400000).toISOString().slice(0, 10) : '';
    const date = serial || toIsoDate(raw);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const nav = toNumber(row[navAt]), market = toNumber(row[marketAt]);
    if (nav === null && market === null) continue;
    byDate.set(date, { date, nav, market, netAssets: assetsAt >= 0 ? toNumber(row[assetsAt]) : null });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
export function historySheetRows(days: PriceDay[]): SheetRow[] {
  return days.map(day => ({
    Date: day.date,
    NAV: day.nav === null ? '' : String(round(day.nav, 4)),
    'Market Price': day.market === null ? '' : String(round(day.market, 4)),
    'Premium/Discount': day.nav !== null && day.market !== null && day.nav > 0 ? `${((day.market / day.nav - 1) * 100).toFixed(4)}%` : '',
    'Total Net Assets': day.netAssets === null ? '' : String(round(day.netAssets, 2)),
  }));
}
export function historyStartDate(range: string, minDate: string, maxDate: string): string {
  const months: Record<string, number> = { '10y': 120, '5y': 60, '2y': 24, '1y': 12, '6mo': 6, '3mo': 3 };
  const min = toIsoDate(minDate), max = toIsoDate(maxDate);
  if (!(range in months) || !/^\d{4}-\d{2}-\d{2}$/.test(max)) return min;
  const end = new Date(`${max}T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() - months[range]);
  const start = end.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(min) && min > start ? min : start;
}
function usDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : iso;
}

function arrayOfNumbers(value: unknown): (number | null)[] {
  return Array.isArray(value) ? value.map(toNumber) : [];
}
export function parseYahooChart(payload: unknown): ChartDay[] {
  if (!isRecord(payload)) return [];
  const chart = isRecord(payload.chart) ? payload.chart : {};
  const resultRows = Array.isArray(chart.result) ? chart.result : [];
  const first = isRecord(resultRows[0]) ? resultRows[0] : null;
  if (!first) return [];
  const timestamps = Array.isArray(first.timestamp) ? first.timestamp.map(value => Number(value)) : [];
  const indicators = isRecord(first.indicators) ? first.indicators : {};
  const quotes = Array.isArray(indicators.quote) && isRecord(indicators.quote[0]) ? indicators.quote[0] : {};
  const closes = arrayOfNumbers(quotes.close);
  const adjContainer = Array.isArray(indicators.adjclose) && isRecord(indicators.adjclose[0]) ? indicators.adjclose[0] : {};
  const adjusted = arrayOfNumbers(adjContainer.adjclose);
  const events = isRecord(first.events) ? first.events : {};
  const dividendEvents = isRecord(events.dividends) ? events.dividends : {};
  const dividendByDate = new Map<number, number>();
  for (const [stamp, raw] of Object.entries(dividendEvents)) {
    const item = isRecord(raw) ? raw : {};
    const epoch = Number(stamp);
    const amount = toNumber(item.amount);
    if (Number.isFinite(epoch) && amount !== null && amount > 0) dividendByDate.set(epoch, amount);
  }
  const days = timestamps.map((epoch, index) => {
    const close = closes[index] ?? null;
    const adj = adjusted[index] ?? close;
    return {
      date: Number.isFinite(epoch) ? new Date(epoch * 1000).toISOString().slice(0, 10) : '',
      close: close !== null ? round(close, 2) : null,
      adjClose: adj !== null ? round(adj, 2) : null,
      dividend: dividendByDate.get(epoch) ?? null,
    };
  }).filter(day => day.date && (day.close !== null || day.adjClose !== null));
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

export function parseNportHoldings(xml: string): SheetRow[] {
  const decoded = String(xml).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const tag = (body: string, name: string): string => new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(body)?.[1]?.trim() ?? '';
  const rows: SheetRow[] = [];
  for (const match of decoded.matchAll(/<invstOrSec>([\s\S]*?)<\/invstOrSec>/gi)) {
    const body = match[1];
    const identifier = tag(body, 'cusip') || /<(?:isin|sedol|other)[^>]*value="([^"]+)"/i.exec(body)?.[1] || '-';
    const name = tag(body, 'name') || tag(body, 'title') || '-';
    const value = tag(body, 'valUSD') || tag(body, 'curVal') || '0';
    rows.push({ Name: name, Ticker: '-', Identifier: identifier, Weight: tag(body, 'pctVal') || '0', 'Market Value': value, 'Shares Held': tag(body, 'balance') || '-', 'Asset Category': tag(body, 'assetCat') || '-' });
  }
  return rows;
}
export function parseFundTickerRefs(payload: unknown): Map<string, { cik: string; seriesId: string }> {
  const result = new Map<string, { cik: string; seriesId: string }>();
  if (!isRecord(payload) || !Array.isArray(payload.fields) || !Array.isArray(payload.data)) return result;
  const fields = payload.fields.map(String);
  const index = (key: string): number => fields.indexOf(key);
  const ti = index('symbol'), ci = index('cik'), si = index('seriesId');
  for (const row of payload.data) {
    if (!Array.isArray(row)) continue;
    const ticker = tickerClean(row[ti]);
    const cik = String(row[ci] ?? '').replace(/\D/g, '');
    const seriesId = String(row[si] ?? '').toUpperCase();
    if (ticker && cik && seriesId) result.set(ticker, { cik: cik.padStart(10, '0'), seriesId });
  }
  return result;
}
export function parseAtomFilings(xml: string): { cik: string; accession: string }[] {
  const result: { cik: string; accession: string }[] = [];
  for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
    const body = match[1];
    const form = /<(?:filing-type|type)>([\s\S]*?)<\/(?:filing-type|type)>/i.exec(body)?.[1]?.trim();
    if (form && form.toUpperCase() !== 'NPORT-P') continue;
    const accession = /<accession-number>([\s\S]*?)<\/accession-number>/i.exec(body)?.[1]?.trim();
    const href = /<filing-href>([\s\S]*?)<\/filing-href>/i.exec(body)?.[1] ?? '';
    const cik = /\/edgar\/data\/(\d+)\//i.exec(href)?.[1] ?? '';
    if (accession && cik) result.push({ cik, accession });
  }
  return result;
}

// =========================================================================
// Derived metrics, filters and index entries
// =========================================================================

export function metricsFromReturns(monthEnd: ReturnRow): JsonRecord {
  const total = (cagr: number | null, years: number): number | null => cagr === null ? null : round(((1 + cagr / 100) ** years - 1) * 100, 2);
  return {
    tr1y: monthEnd.yr1, tr3y: total(monthEnd.yr3, 3), tr5y: total(monthEnd.yr5, 5), tr10y: total(monthEnd.yr10, 10),
    cagr3y: monthEnd.yr3, cagr5y: monthEnd.yr5, cagr10y: monthEnd.yr10, siAnn: monthEnd.sinceInception,
  };
}
function fundReturns(fund: Fund): ReturnRow {
  const returns = isRecord(fund.returns) && isRecord(fund.returns.monthEnd) ? fund.returns.monthEnd : {};
  return {
    asOfDate: typeof returns.asOfDate === 'string' ? returns.asOfDate : null, mo3: toNumber(returns.mo3),
    ytd: toNumber(returns.ytd), yr1: toNumber(returns.yr1), yr3: toNumber(returns.yr3), yr5: toNumber(returns.yr5),
    yr10: toNumber(returns.yr10), sinceInception: toNumber(returns.sinceInception),
  };
}
function metricForFilter(fund: Fund, period: string, total: boolean): number | null {
  const monthEnd = fundReturns(fund);
  const key: Record<string, keyof Omit<ReturnRow, 'asOfDate'>> = { YTD: 'ytd', '1Y': 'yr1', '3Y': 'yr3', '5Y': 'yr5', '10Y': 'yr10' };
  const value = monthEnd[key[period]];
  if (value === null || !total || period === 'YTD' || period === '1Y') return value;
  return round(((1 + value / 100) ** Number.parseInt(period, 10) - 1) * 100, 2);
}
export function fundPasses(fund: Fund, config: Config): boolean {
  if (!inRange(fund.aumValue, config.aum) || !inRange(fund.terValue, config.ter) || !inRange(fund.dividendYield, config.dividendYield) || !inRange(fund.secYield, config.secYield)) return false;
  return RETURN_PERIODS.every(period => inRange(metricForFilter(fund, period, false), config.performance[period]) && inRange(metricForFilter(fund, period, true), config.totalReturn[period]));
}
function needsSummaryForFilters(fund: Fund, config: Config): boolean {
  if (isActive(config.aum) && fund.aumValue === null) return true;
  if (isActive(config.ter) && fund.terValue === null) return true;
  return RETURN_PERIODS.some(period => (isActive(config.performance[period]) || isActive(config.totalReturn[period])) && metricForFilter(fund, period, false) === null);
}
/** Copies summary-page facts onto a catalog fund (AUM, TER, returns, yields). */
export function applySummary(fund: Fund, summary: Summary): Fund {
  const gross = toNumber(summaryValue(summary, 'Total Expense Ratio', 'Gross Expense Ratio', 'Expense Ratio')?.value);
  const net = toNumber(summaryValue(summary, 'Net Expense Ratio')?.value);
  const aum = toNumber(summaryValue(summary, 'Total Net Assets', 'Net Assets')?.value);
  const nav = toNumber(summaryValue(summary, 'Closing NAV')?.value);
  const sec = toNumber(summaryValue(summary, '30-Day SEC Yield')?.value);
  const rate12 = toNumber(summaryValue(summary, '12-Month Distribution Rate')?.value);
  fund.terValue = gross ?? net ?? fund.terValue;
  fund.netExpenseRatio = net;
  fund.aumValue = aum ?? fund.aumValue;
  fund.navValue = nav ?? fund.navValue;
  fund.secYield = sec ?? fund.secYield;
  fund.dividendYield = rate12 ?? fund.dividendYield;
  fund.returns = { monthEnd: summary.monthEnd, quarterEnd: summary.quarterEnd };
  fund.summary = summary;
  return fund;
}
function fundPageUrl(ticker: string): string { return `${ETF_PATH}/EtfSummary.aspx?Ticker=${encodeURIComponent(ticker)}`; }
function cachedFundFromIndex(item: JsonRecord): Fund {
  const metrics = isRecord(item.metrics) ? item.metrics : {};
  return {
    ...item, ticker: String(item.ticker ?? ''), name: String(item.name ?? ''), category: String(item.category ?? ''),
    navValue: toNumber(item.navValue), aumValue: toNumber(item.aumValue), terValue: toNumber(item.terValue),
    dividendYield: toNumber(metrics.dividendYield), secYield: toNumber(metrics.secYield), fromCache: true,
  };
}
function mergePrevious(fund: Fund, previous: JsonRecord | undefined): Fund {
  if (!previous) return fund;
  if (fund.aumValue === null) fund.aumValue = toNumber(previous.aumValue);
  if (fund.terValue === null) fund.terValue = toNumber(previous.terValue);
  if (!isRecord(fund.returns) && isRecord(previous.returns)) fund.returns = previous.returns;
  const metrics = isRecord(previous.metrics) ? previous.metrics : {};
  if (fund.dividendYield === null) fund.dividendYield = toNumber(metrics.dividendYield);
  if (fund.secYield === null) fund.secYield = toNumber(metrics.secYield);
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
  const monthEnd = isRecord(returns.monthEnd) ? returns.monthEnd : emptyReturns();
  const quarterEnd = isRecord(returns.quarterEnd) ? returns.quarterEnd : emptyReturns();
  const yields = isRecord(meta.yields) ? meta.yields : {};
  const distributions = isRecord(meta.distributions) ? meta.distributions : {};
  const premium = isRecord(meta.premiumDiscount) ? meta.premiumDiscount : {};
  const holdings = isRecord(meta.holdings) ? toNumber(meta.holdings.totalRows) ?? 0 : 0;
  const history = isRecord(meta.history) ? toNumber(meta.history.totalRows) ?? 0 : 0;
  const navValue = toNumber(nav.value), closeValue = toNumber(market.value), aumValue = toNumber(aum.value), terValue = toNumber(expense.value);
  const dividendYield = toNumber(yields.dividendYield), secYield = toNumber(yields.secYield);
  const withDisplayDate = (row: JsonRecord): JsonRecord => ({ ...row, asOfDate: row.asOfDate ? displayDate(row.asOfDate) : null });
  return {
    ticker: fund.ticker, name: String(meta.name ?? fund.name), category: String(meta.category ?? fund.category),
    fundPage: fundPageUrl(fund.ticker), dataFile: `./funds/${fund.ticker}/meta.json`,
    ter: formatPercent(terValue), terValue, nav: navValue === null ? '—' : `$${navValue.toFixed(2)}`, navValue,
    aum: formatMoney(aumValue), aumValue, asOfDate: nav.asOfDate ? String(nav.asOfDate) : '—',
    inceptionDate: inception.fundInceptionDate ? displayDate(inception.fundInceptionDate) : '—', exchange: String(inception.exchange ?? '—'),
    closePrice: closeValue === null ? '—' : `$${closeValue.toFixed(2)}`, premiumDiscount: formatPercent(toNumber(premium.value)),
    cusip: ids.cusip ?? null, isin: ids.isin ?? null,
    distributions: {
      frequency: distributions.frequency ?? null,
      exDate: distributions.latestExDate ? displayDate(distributions.latestExDate) : '',
      dividend: distributions.latestAmount ?? '',
    },
    returns: { monthEnd: withDisplayDate(monthEnd), quarterEnd: withDisplayDate(quarterEnd) },
    metrics: {
      ...metricsFromReturns({
        asOfDate: null, mo3: toNumber(monthEnd.mo3), ytd: toNumber(monthEnd.ytd), yr1: toNumber(monthEnd.yr1), yr3: toNumber(monthEnd.yr3),
        yr5: toNumber(monthEnd.yr5), yr10: toNumber(monthEnd.yr10), sinceInception: toNumber(monthEnd.sinceInception),
      }),
      dividendYield, dividendYieldText: dividendYield === null ? null : formatPercent(dividendYield),
      secYield, secYieldText: secYield === null ? null : formatPercent(secYield),
    },
    holdings, history,
  };
}
/** Catalog-only entry for funds that have never been fetched (no meta.json yet). */
export function catalogOnlyEntry(fund: Fund): JsonRecord {
  const nav = fund.navValue;
  return {
    ticker: fund.ticker, name: fund.name, category: fund.category, fundPage: fundPageUrl(fund.ticker), dataFile: `./funds/${fund.ticker}/meta.json`,
    ter: formatPercent(fund.terValue), terValue: fund.terValue, nav: nav === null ? '—' : `$${nav.toFixed(2)}`, navValue: nav,
    aum: formatMoney(fund.aumValue), aumValue: fund.aumValue, asOfDate: '—',
    inceptionDate: fund.inceptionListed ? displayDate(fund.inceptionListed) : '—', exchange: '—', closePrice: '—', premiumDiscount: '—',
    cusip: null, isin: null, distributions: { frequency: null, exDate: '', dividend: '' },
    returns: { monthEnd: emptyReturns(), quarterEnd: emptyReturns() },
    metrics: {
      ...metricsFromReturns(emptyReturns()),
      dividendYield: fund.dividendYield, dividendYieldText: fund.dividendYield === null ? null : formatPercent(fund.dividendYield),
      secYield: fund.secYield, secYieldText: fund.secYield === null ? null : formatPercent(fund.secYield),
    },
    holdings: 0, history: 0,
  };
}

// =========================================================================
// Static files
// =========================================================================

function pageFile(kind: 'holdings' | 'history', page: number): string { return `${kind}/${String(page + 1).padStart(3, '0')}.json`; }
export function buildPages<T>(rows: T[], pageSize: number): T[][] {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('pageSize must be a positive integer');
  const pages: T[][] = [];
  for (let offset = 0; offset < rows.length; offset += pageSize) pages.push(rows.slice(offset, offset + pageSize));
  return pages;
}
export function pageBasenames(paths: string[]): Set<string> { return new Set(paths.map(path => path.split('/').at(-1) ?? path)); }

async function readJson(url: URL): Promise<unknown> { return readFile(url, 'utf8').then(JSON.parse).catch(() => null); }
async function samePublishedContent(url: URL, value: unknown): Promise<boolean> {
  const previous = await readJson(url);
  return previous !== null && outputContentKey(previous) === outputContentKey(value);
}
async function writeJsonIfChanged(url: URL, value: unknown): Promise<boolean> {
  if (await samePublishedContent(url, value)) return false;
  await mkdir(new URL('.', url), { recursive: true });
  await writeFile(url, `${JSON.stringify(value, null, 1)}\n`, 'utf8');
  return true;
}
async function writePages(ticker: string, kind: 'holdings' | 'history', headers: string[], rows: SheetRow[], size: number, asOfDate: string | null, source: string): Promise<PageManifest> {
  const dir = new URL(`funds/${ticker}/`, API_ROOT);
  await mkdir(new URL(`${kind}/`, dir), { recursive: true });
  const pages: string[] = [];
  const chunks = buildPages(rows, size);
  for (const [index, chunk] of chunks.entries()) {
    const name = pageFile(kind, index);
    pages.push(name);
    await writeJsonIfChanged(new URL(name, dir), { headers, rows: chunk, asOfDate });
  }
  const keep = pageBasenames(pages);
  const folder = new URL(`${kind}/`, dir);
  for (const entry of await readdir(folder).catch(() => [])) if (entry.endsWith('.json') && !keep.has(entry)) await rm(new URL(entry, folder), { force: true });
  return { pages, pageSize: size, totalRows: rows.length, asOfDate, source };
}
async function previousRows(ticker: string, kind: 'holdings' | 'history'): Promise<{ headers: string[]; rows: SheetRow[] }> {
  const meta = await readJson(new URL(`funds/${ticker}/meta.json`, API_ROOT));
  const root = isRecord(meta) ? meta[kind] : null;
  if (!isRecord(root) || !Array.isArray(root.pages)) return { headers: kind === 'holdings' ? HOLDINGS_HEADERS : HISTORY_HEADERS, rows: [] };
  let headers: string[] = [];
  const rows: SheetRow[] = [];
  for (const name of root.pages) {
    if (typeof name !== 'string') continue;
    const page = await readJson(new URL(`funds/${ticker}/${name}`, API_ROOT));
    if (!isRecord(page)) continue;
    if (Array.isArray(page.headers)) headers = page.headers.filter((value): value is string => typeof value === 'string');
    if (Array.isArray(page.rows)) rows.push(...page.rows.filter(isRecord).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value ?? '')]))));
  }
  return { headers: headers.length ? headers : kind === 'holdings' ? HOLDINGS_HEADERS : HISTORY_HEADERS, rows };
}
async function previousIndex(): Promise<Map<string, JsonRecord>> {
  const data = await readJson(INDEX_FILE);
  const funds = isRecord(data) && Array.isArray(data.funds) ? data.funds : [];
  const result = new Map<string, JsonRecord>();
  for (const item of funds) if (isRecord(item) && typeof item.ticker === 'string') result.set(item.ticker, item);
  return result;
}
async function readCursor(): Promise<string> {
  const state = await readJson(STATE_FILE);
  return isRecord(state) && typeof state.lastProcessedTicker === 'string' ? state.lastProcessedTicker : '';
}

// =========================================================================
// Network: per-worker paced lanes, retries
// =========================================================================

// One independently paced lane per worker; do not serialize all workers behind one shared gate.
let laneTimes: number[] = [0];
let requestSleepMs = 1000;
export function createRequestGate(lanes: number, sleepMs: number, now: () => number = Date.now, sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const times = new Array(Math.max(1, lanes)).fill(0);
  return async function pace(): Promise<number> {
    let lane = 0;
    for (let i = 1; i < times.length; i++) if (times[i] < times[lane]) lane = i;
    const wait = Math.max(0, times[lane] - now());
    times[lane] = now() + wait + sleepMs;
    if (wait > 0) await sleep(wait);
    return lane;
  };
}
async function paceRequest(): Promise<void> {
  let lane = 0;
  for (let i = 1; i < laneTimes.length; i++) if (laneTimes[i] < laneTimes[lane]) lane = i;
  const wait = Math.max(0, laneTimes[lane] - Date.now());
  laneTimes[lane] = Date.now() + wait + requestSleepMs;
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
}
async function fetchRetry(url: string, label: string, init: RequestInit, config: Config, retries = config.maxRetries): Promise<Response> {
  let last: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await paceRequest();
    try {
      const response = await fetch(url, { redirect: 'follow', ...init });
      if (response.ok) return response;
      last = new Error(`HTTP ${response.status} ${response.statusText}`);
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) { last = error; }
    if (attempt < retries) {
      const wait = Math.min(15000, 750 * (2 ** attempt));
      outputNote(`[ retry    ] ${label}: retry ${attempt + 1}/${retries} in ${wait}ms`);
      await new Promise(resolve => setTimeout(resolve, wait));
    }
  }
  throw new Error(`${label}: ${last instanceof Error ? last.message : String(last)}`);
}
async function getText(url: string, label: string, headers: Record<string, string>, config: Config): Promise<string> {
  return (await fetchRetry(url, label, { headers }, config)).text();
}
async function getJson(url: string, label: string, headers: Record<string, string>, config: Config): Promise<unknown> {
  const text = await getText(url, label, headers, config);
  try { return JSON.parse(text); } catch { throw new Error(`${label}: response was not valid JSON`); }
}
const ISSUER_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36', Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' };
function yahooHeaders(): Record<string, string> { return { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36', Accept: 'application/json' }; }
function secHeaders(config: Config): Record<string, string> { return { 'User-Agent': config.secUa, Accept: 'application/json, application/atom+xml, application/xml;q=0.9' }; }

async function fetchIssuerPage(page: string, ticker: string, config: Config, extra = ''): Promise<string> {
  return getText(`${ETF_PATH}/${page}.aspx?Ticker=${encodeURIComponent(ticker)}${extra}`, `[ product  ] ${ticker} ${page}`, ISSUER_HEADERS, config);
}
/** Official price-history XLSX export: GET the page, then post its ASP.NET form with the full date range. */
async function fetchOfficialHistory(ticker: string, config: Config): Promise<PriceDay[]> {
  const url = `${ETF_PATH}/EtfPriceHistory.aspx?Ticker=${encodeURIComponent(ticker)}`;
  const first = await fetchRetry(url, `[ history  ] ${ticker} page`, { headers: ISSUER_HEADERS }, config);
  const cookies = (first.headers.getSetCookie?.() ?? []).map(cookie => cookie.split(';')[0]).join('; ');
  const html = await first.text();
  const form = parseHiddenInputs(html);
  const prefix = 'ctl00$ContentPlaceHolder1$PriceHistory$';
  const minDate = form[`${prefix}txtMinDate`] ?? '', maxDate = form[`${prefix}txtMaxDate`] ?? '';
  if (!minDate || !maxDate) throw new Error(`${ticker}: price history page exposed no date range`);
  const body = new URLSearchParams({
    ...form,
    [`${prefix}txtStartDate`]: usDate(historyStartDate(config.historyRange, minDate, maxDate)),
    [`${prefix}txtEndDate`]: maxDate,
    [`${prefix}btnDownload`]: 'Download',
  });
  const response = await fetchRetry(url, `[ history  ] ${ticker} xlsx`, {
    method: 'POST', body: body.toString(),
    headers: { ...ISSUER_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded', Referer: url, ...(cookies ? { Cookie: cookies } : {}) },
  }, config);
  const type = response.headers.get('content-type') ?? '';
  if (!/spreadsheetml|octet-stream|excel/i.test(type)) throw new Error(`${ticker}: price export returned ${type || 'unknown content'}`);
  return parsePriceHistoryRows(readXlsxRows(new Uint8Array(await response.arrayBuffer())));
}
async function fetchYahoo(ticker: string, range: string, config: Config): Promise<ChartDay[]> {
  const allowed = new Set(['max', '10y', '5y', '2y', '1y', '6mo', '3mo']);
  const selectedRange = allowed.has(range) ? range : 'max';
  const query = new URLSearchParams({ range: selectedRange, interval: '1d', events: 'div,splits' });
  return parseYahooChart(await getJson(`${YAHOO_CHART}/${encodeURIComponent(ticker)}?${query}`, `[ chart    ] ${ticker}`, yahooHeaders(), config));
}
async function fetchEdgarHoldings(ticker: string, config: Config): Promise<{ rows: SheetRow[]; asOfDate: string | null; cik: string | null }> {
  if (!config.edgarFallback) return { rows: [], asOfDate: null, cik: null };
  if (!config.secUa) {
    outputNote(`[ edgar    ] ${ticker}: SEC fallback not attempted; configure SEC_UA with a valid organizational contact`);
    return { rows: [], asOfDate: null, cik: null };
  }
  try {
    const lookup = await getJson(SEC_MF_TICKERS, '[ edgar    ] fund ticker table', secHeaders(config), config);
    const ref = parseFundTickerRefs(lookup).get(ticker);
    if (!ref) return { rows: [], asOfDate: null, cik: null };
    const params = new URLSearchParams({ action: 'getcompany', CIK: ref.seriesId, type: 'NPORT-P', owner: 'include', count: '10', output: 'atom' });
    const atom = await getText(`${SEC_BROWSE}?${params}`, `[ edgar    ] ${ticker} N-PORT-P index`, secHeaders(config), config);
    const latest = parseAtomFilings(atom)[0];
    if (!latest) return { rows: [], asOfDate: null, cik: ref.cik };
    const primary = `${SEC_ARCHIVES}/${Number(latest.cik)}/${latest.accession.replace(/-/g, '')}/primary_doc.xml`;
    const xml = await getText(primary, `[ edgar    ] ${ticker} N-PORT-P`, { ...secHeaders(config), Accept: 'application/xml,text/xml' }, config);
    return { rows: parseNportHoldings(xml), asOfDate: toIsoDate(/<repPdDate>([\s\S]*?)<\/repPdDate>/i.exec(xml)?.[1]) || null, cik: ref.cik };
  } catch (error) {
    outputNote(`[ edgar    ] ${ticker}: ${error instanceof Error ? error.message : String(error)}`);
    return { rows: [], asOfDate: null, cik: null };
  }
}
async function fetchDistributions(ticker: string, previous: string[][], config: Config): Promise<{ rows: string[][]; fresh: boolean }> {
  const first = parseDistributionHtml(await fetchIssuerPage('EtfDividHistory', ticker, config));
  const fetched = new Set<number>();
  let fresh = first.rows;
  if (first.selectedYear !== null) fetched.add(first.selectedYear);
  const previousYears = previous.map(row => Number(String(row[0]).slice(0, 4))).filter(Number.isFinite);
  const newestPublished = previousYears.length ? Math.max(...previousYears) : null;
  // First run: every listed year. Later runs: re-read the latest published year onwards and keep older published rows.
  const years = first.years.filter(year => !fetched.has(year) && (newestPublished === null || year >= newestPublished - 1));
  for (const year of years) {
    const page = parseDistributionHtml(await fetchIssuerPage('EtfDividHistory', ticker, config, `&year=${year}&Print=Y`));
    fresh = [...fresh, ...page.rows.filter(row => row[0].startsWith(String(year)))];
    fetched.add(year);
  }
  return { rows: mergeDistributionRows(fresh, previous, fetched), fresh: true };
}

// =========================================================================
// Per-fund processing
// =========================================================================

const summaryCache = new Map<string, Summary>();
async function loadSummary(ticker: string, config: Config): Promise<Summary> {
  const cached = summaryCache.get(ticker);
  if (cached) return cached;
  const summary = parseSummaryHtml(await fetchIssuerPage('EtfSummary', ticker, config));
  summaryCache.set(ticker, summary);
  return summary;
}

async function createMeta(fund: Fund, config: Config): Promise<JsonRecord> {
  const summary = await loadSummary(fund.ticker, config);
  applySummary(fund, summary);
  const priorMeta = await readJson(new URL(`funds/${fund.ticker}/meta.json`, API_ROOT));
  const prior = isRecord(priorMeta) ? priorMeta : {};

  // Holdings: official HTML table -> SEC N-PORT-P -> previously published rows.
  let holdings = { headers: HOLDINGS_HEADERS, rows: [] as SheetRow[], asOfDate: null as string | null };
  try { holdings = parseHoldingsHtml(await fetchIssuerPage('EtfHoldings', fund.ticker, config)); }
  catch (error) { outputNote(`[ holdings ] ${fund.ticker}: ${error instanceof Error ? error.message : String(error)}`); }
  let holdRows = holdings.rows, holdingsAsOf = holdings.asOfDate, holdingSource = 'First Trust official holdings page (ftportfolios.com EtfHoldings.aspx)';
  if (!holdRows.length) {
    const sec = await fetchEdgarHoldings(fund.ticker, config);
    if (sec.rows.length) { holdRows = sec.rows; holdingsAsOf = sec.asOfDate; holdingSource = `SEC EDGAR N-PORT-P (CIK ${sec.cik ?? 'unknown'}; ${sec.asOfDate ?? 'report date unavailable'})`; }
  }
  if (!holdRows.length) {
    const previous = await previousRows(fund.ticker, 'holdings');
    if (previous.rows.length) {
      holdRows = previous.rows;
      holdingsAsOf = isRecord(prior.holdings) && typeof prior.holdings.asOfDate === 'string' ? prior.holdings.asOfDate : null;
      holdingSource = 'previously published First Trust holdings (retained because the current sources returned none)';
    }
  }

  // History: official XLSX export -> Yahoo market closes -> previously published rows.
  let historyRowsOut: SheetRow[] = [], historySource = '', historyAsOf: string | null = null;
  try {
    const days = await fetchOfficialHistory(fund.ticker, config);
    if (days.length) { historyRowsOut = historySheetRows(days); historyAsOf = days.at(-1)?.date ?? null; historySource = 'First Trust official daily NAV / market price history (ftportfolios.com EtfPriceHistory.aspx Excel export)'; }
  } catch (error) { outputNote(`[ history  ] ${fund.ticker}: ${error instanceof Error ? error.message : String(error)}`); }
  if (!historyRowsOut.length && !config.skipYahoo) {
    try {
      const days = await fetchYahoo(fund.ticker, config.historyRange, config);
      if (days.length) {
        historyRowsOut = historySheetRows(days.map(day => ({ date: day.date, nav: null, market: day.close, netAssets: null })));
        historyAsOf = days.at(-1)?.date ?? null;
        historySource = 'Yahoo Finance market-price chart (fallback; no NAV in this series)';
      }
    } catch (error) { outputNote(`[ chart    ] ${fund.ticker}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (!historyRowsOut.length) {
    const previous = await previousRows(fund.ticker, 'history');
    historyRowsOut = previous.rows;
    historyAsOf = previous.rows.at(-1)?.Date ?? null;
    historySource = previous.rows.length ? 'previously published history retained because the official export and Yahoo were unavailable' : 'history unavailable; nothing has been published yet';
  }

  // Distributions: official per-year pages (incremental), previously published rows kept.
  const priorDist = isRecord(prior.distributions) && Array.isArray(prior.distributions.rows)
    ? prior.distributions.rows.filter((row): row is string[] => Array.isArray(row)).map(row => row.map(cell => String(cell ?? ''))) : [];
  let distRows = priorDist, distributionSource = 'previously published First Trust distribution history (current request failed)';
  try {
    const result = await fetchDistributions(fund.ticker, priorDist, config);
    distRows = result.rows;
    distributionSource = 'First Trust official distribution history (ftportfolios.com EtfDividHistory.aspx, all listed years)';
  } catch (error) { outputNote(`[ history  ] ${fund.ticker} distributions: ${error instanceof Error ? error.message : String(error)}`); }
  const distSummary = summarizeDistributions(distRows);

  const hManifest = await writePages(fund.ticker, 'holdings', HOLDINGS_HEADERS, holdRows, config.holdingsPageSize, holdingsAsOf, holdingSource);
  const yManifest = await writePages(fund.ticker, 'history', HISTORY_HEADERS, historyRowsOut, config.historyPageSize, historyAsOf, historySource);

  const pair = (...labels: string[]): SummaryPair | null => summaryValue(summary, ...labels);
  const nav = toNumber(pair('Closing NAV')?.value) ?? fund.navValue;
  const market = toNumber(pair('Closing Market Price')?.value);
  const premium = toNumber(pair('Bid/Ask Premium', 'Bid/Ask Premium/Discount')?.value);
  const aum = toNumber(pair('Total Net Assets', 'Net Assets')?.value) ?? fund.aumValue;
  const gross = toNumber(pair('Total Expense Ratio', 'Gross Expense Ratio', 'Expense Ratio')?.value);
  const net = toNumber(pair('Net Expense Ratio')?.value);
  const ter = gross ?? net;
  const secPair = pair('30-Day SEC Yield');
  const secYield = toNumber(secPair?.value) ?? fund.secYield;
  const ratePair = pair('12-Month Distribution Rate');
  const rate12 = toNumber(ratePair?.value);
  const annualPayments: Record<string, number> = { Monthly: 12, Quarterly: 4, 'Semi-annually': 2, Annually: 1 };
  const indicated = distSummary.latest !== null && distSummary.frequency && annualPayments[distSummary.frequency] && market !== null && market > 0
    ? round(distSummary.latest * annualPayments[distSummary.frequency] / market * 100, 2) : null;
  const catalogRate = toNumber(fund.dividendYield);
  const dividendYield = rate12 ?? catalogRate ?? indicated;
  const navAsOf = summary.navAsOf ?? historyAsOf;
  const meta: JsonRecord = {
    ticker: fund.ticker, name: fund.name, category: fund.category,
    source: {
      fundPage: fundPageUrl(fund.ticker), catalog: ISSUER_LIST_PAGE, issuerHome: ISSUER_HOME,
      holdingsPage: `${ETF_PATH}/EtfHoldings.aspx?Ticker=${fund.ticker}`,
      historyPage: `${ETF_PATH}/EtfPriceHistory.aspx?Ticker=${fund.ticker}`,
      distributionPage: `${ETF_PATH}/EtfDividHistory.aspx?Ticker=${fund.ticker}`,
      yahooChart: `${YAHOO_CHART}/${fund.ticker}`,
      holdingsSource: holdingSource, historySource, distributionSource,
      provider: PROVIDER,
    },
    fundType: pair('Fund Type')?.value || null,
    identifiers: { cusip: pair('CUSIP')?.value || null, isin: pair('ISIN')?.value || null, iopv: pair('Intraday NAV')?.value || null, indexTicker: summary.benchmark },
    inception: { fundInceptionDate: toIsoDate(pair('Inception')?.value) || fund.inceptionListed || null, exchange: pair('Exchange')?.value || null },
    expenseRatio: { display: formatPercent(ter), value: ter, gross, net, asOfDate: summary.expenseAsOf ?? pair('Total Expense Ratio')?.asOf ?? null },
    nav: { display: nav === null ? null : `$${nav.toFixed(2)}`, value: nav, asOfDate: navAsOf ? displayDate(navAsOf) : null },
    marketPrice: { display: market === null ? null : `$${market.toFixed(2)}`, value: market, asOfDate: navAsOf ? displayDate(navAsOf) : null },
    premiumDiscount: { display: formatPercent(premium), value: premium, basis: 'First Trust published bid/ask premium' },
    aum: { display: formatMoney(aum), value: aum, asOfDate: navAsOf ? displayDate(navAsOf) : null, source: 'First Trust fund summary (Total Net Assets)' },
    shares: { outstanding: toNumber(pair('Outstanding Shares')?.value) },
    yields: {
      dividendYield, dividendYieldText: dividendYield === null ? null : formatPercent(dividendYield),
      dividendYieldKind: rate12 !== null
        ? `First Trust published 12-month distribution rate${ratePair?.asOf ? ` as of ${displayDate(ratePair.asOf)}` : ''}`
        : catalogRate !== null ? `First Trust ETF list 12-month trailing distribution rate${fund.yieldAsOf ? ` as of ${displayDate(fund.yieldAsOf)}` : ''}`
        : indicated !== null ? 'Indicated from the latest ordinary distribution per share x inferred payments per year / market price' : null,
      distributionRate: toNumber(pair('Distribution Rate')?.value),
      distributionPerShare: toNumber(pair('Distribution per Share Amt')?.value),
      secYield, secYieldText: secYield === null ? null : formatPercent(secYield),
      secYieldKind: secYield === null ? null : `First Trust 30-day SEC yield${secPair?.asOf ? ` as of ${displayDate(secPair.asOf)}` : fund.yieldAsOf ? ` as of ${displayDate(fund.yieldAsOf)}` : ''}`,
      unsubsidizedSecYield: toNumber(fund.unsubsidizedSecYield),
    },
    returns: { derivedFrom: 'First Trust published NAV performance (month-end and quarter-end; average annualized for periods of one year or more)', monthEnd: summary.monthEnd, quarterEnd: summary.quarterEnd },
    distributions: {
      frequency: distSummary.frequency, latestAmount: distSummary.latest, latestExDate: distSummary.exDate,
      headers: DISTRIBUTION_HEADERS, rows: distRows, source: distributionSource,
    },
    holdings: hManifest, history: yManifest,
    holdingsCount: hManifest.totalRows, historyCount: yManifest.totalRows, distributionCount: distRows.length,
    netAssets: aum, dividendYield, secYield,
  };
  return meta;
}

async function processFund(fund: Fund, config: Config, reporter: ReturnType<typeof outputCreateReporter>): Promise<JsonRecord | null> {
  const before = await outputInspectFund(fund.ticker);
  let meta: JsonRecord;
  try { meta = await createMeta(fund, config); }
  catch (error) {
    const previous = before.meta;
    await reporter.result(fund.ticker, before, previous, 'failed', error instanceof Error ? error.message : String(error));
    return Object.keys(previous).length ? previous : null;
  }
  await writeJsonIfChanged(new URL(`funds/${fund.ticker}/meta.json`, API_ROOT), meta);
  await reporter.result(fund.ticker, before, meta);
  return meta;
}
export async function mapWithConcurrency<T>(items: T[], concurrency: number, work: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
    while (true) { const index = next++; if (index >= items.length) return; await work(items[index], index); }
  });
  await Promise.all(workers);
}
function printHelp(): void {
  console.log(`First Trust ETF updater (Bun only)

Usage: bun scripts/update-data.ts

Environment:
  MAX_FETCHES=0             Funds per run (0 = all eligible; resumes after saved ticker cursor)
  TICKERS="FDN FTSM FJAN"   Only process the named tickers
  REQUEST_SLEEP=1           Minimum seconds between request starts per worker lane
  CONCURRENCY=2             Parallel fund workers (default conservative)
  MAX_RETRIES=2             Retries after initial request
  HOLDINGS_PAGE_SIZE=250    Rows per static holdings page
  HISTORY_PAGE_SIZE=1000    Rows per static NAV-history page
  HISTORY_RANGE=max         History window: max, 10y, 5y, 2y, 1y, 6mo or 3mo (official export and Yahoo fallback)
  AUM=:                     AUM min:max (K/M/B/T suffixes) or nano/micro/small/mid/large
  TER=: DIVIDEND_YIELD=: SEC_YIELD=:  Inclusive numeric min:max percentages
  PERFORMANCE_{YTD,1Y,3Y,5Y,10Y}=: Annualized NAV-return filters
  TOTAL_RETURN_{YTD,1Y,3Y,5Y,10Y}=: Cumulative-return filters
  EDGAR_FALLBACK=1          Use SEC N-PORT-P only if official holdings are unavailable
  SEC_UA=<contact>          Required valid SEC User-Agent/contact for EDGAR fallback requests
  SKIP_YAHOO=1              Do not call Yahoo when the official history export fails; retain prior history
  VERBOSE=1                 Show per-request retry/fallback details
`);
}

async function main(): Promise<void> {
  if (process.argv.some(arg => arg === '-h' || arg === '--help')) { printHelp(); return; }
  const config = readConfig();
  requestSleepMs = config.requestSleep * 1000;
  laneTimes = new Array(Math.max(1, config.concurrency)).fill(0);
  outputPrintConfig(config);
  const previous = await previousIndex();
  let catalog: Fund[] = [];
  let live = false;
  try {
    catalog = parseCatalogHtml(await getText(ISSUER_LIST_PAGE, '[ catalog  ] First Trust ETF list', ISSUER_HEADERS, config));
    if (!catalog.length) throw new Error('official ETF list contained no funds');
    live = true;
    console.log(`[ catalog  ] ${catalog.length} First Trust ETFs (ftportfolios.com official ETF list)`);
  } catch (error) {
    console.warn(`[ catalog  ] ${error instanceof Error ? error.message : String(error)} — retaining the published catalog`);
  }
  if (!catalog.length) catalog = [...previous.values()].map(cachedFundFromIndex).filter(fund => Boolean(fund.ticker));
  if (!catalog.length) throw new Error('No current or previously published catalog is available');
  if (live) {
    const known = new Set(catalog.map(fund => fund.ticker));
    for (const item of previous.values()) if (!known.has(String(item.ticker ?? ''))) catalog.push(cachedFundFromIndex(item));
    catalog.sort((a, b) => a.ticker.localeCompare(b.ticker));
  }
  for (const fund of catalog) mergePrevious(fund, previous.get(fund.ticker));

  const candidates = config.tickers.size ? catalog.filter(fund => config.tickers.has(fund.ticker)) : catalog;
  if (config.tickers.size) {
    const missing = [...config.tickers].filter(ticker => !catalog.some(fund => fund.ticker === ticker));
    if (missing.length) throw new Error(`Requested ticker(s) not in the First Trust catalog: ${missing.join(', ')}`);
  }
  const deferred = live ? candidates.filter(fund => needsSummaryForFilters(fund, config)) : [];
  if (deferred.length) {
    await mapWithConcurrency(deferred, config.concurrency, async fund => {
      try { applySummary(fund, await loadSummary(fund.ticker, config)); }
      catch (error) { outputNote(`[ product  ] ${fund.ticker} summary: ${error instanceof Error ? error.message : String(error)}`); }
    });
  }
  const eligible = candidates.filter(fund => fundPasses(fund, config));
  outputPrintFilter(eligible.length, catalog.length, deferred.length > 0);
  if (config.tickers.size) {
    const filtered = [...config.tickers].filter(ticker => !eligible.some(fund => fund.ticker === ticker));
    if (filtered.length) throw new Error(`Requested ticker(s) were excluded by configured filters: ${filtered.join(', ')}`);
  }
  let selected = eligible;
  if (!config.tickers.size && config.maxFetches > 0 && selected.length > config.maxFetches) {
    const cursor = await readCursor();
    const found = selected.findIndex(fund => fund.ticker > cursor);
    const start = found < 0 ? 0 : found;
    selected = [...selected.slice(start), ...selected.slice(0, start)].slice(0, config.maxFetches);
  }
  const savedMeta = new Map<string, JsonRecord>();
  const reporter = outputCreateReporter(selected.length);
  await mapWithConcurrency(selected, config.concurrency, async fund => {
    if (!live) {
      const before = await outputInspectFund(fund.ticker);
      const meta = before.meta;
      await reporter.result(fund.ticker, before, meta, Object.keys(meta).length ? 'unchanged' : 'failed', Object.keys(meta).length ? 'official site unreachable; cached data retained' : 'no provider access or cached fund data');
      return;
    }
    const meta = await processFund(fund, config, reporter);
    if (meta) savedMeta.set(fund.ticker, meta);
  });

  const selectedTickers = new Set(selected.map(fund => fund.ticker));
  const indexFunds: JsonRecord[] = [];
  for (const fund of catalog) {
    const existing = previous.get(fund.ticker);
    const meta = savedMeta.get(fund.ticker);
    if (meta && selectedTickers.has(fund.ticker) && isRecord(meta.nav)) { indexFunds.push(indexEntryFromMeta(fund, meta)); continue; }
    if (existing) { indexFunds.push(existing); continue; }
    indexFunds.push(catalogOnlyEntry(fund));
  }
  const totalHoldings = indexFunds.reduce((sum, row) => sum + (toNumber(row.holdings) ?? 0), 0);
  const totalHistory = indexFunds.reduce((sum, row) => sum + (toNumber(row.history) ?? 0), 0);
  const indexValue = {
    generatedAt: new Date().toISOString(),
    source: {
      provider: 'First Trust ETFs (First Trust Portfolios L.P. / First Trust Advisors L.P.)', market: 'us', site: ISSUER_SITE,
      catalog: ISSUER_LIST_PAGE, issuerHome: ISSUER_HOME,
      fundPages: `${ETF_PATH}/{EtfSummary|EtfHoldings|EtfPriceHistory|EtfDividHistory}.aspx?Ticker={TICKER}`,
      history: 'First Trust official daily NAV / market price history (Excel export); Yahoo Finance chart as fallback',
      holdings: `First Trust official holdings pages; SEC EDGAR Form N-PORT-P (${SEC_TRUSTS}) as fallback`,
    },
    counts: { funds: indexFunds.length, holdings: totalHoldings, history: totalHistory },
    funds: indexFunds,
  };
  const changed = await writeJsonIfChanged(INDEX_FILE, indexValue);
  if (config.maxFetches > 0 && !config.tickers.size && selected.length) {
    await writeJsonIfChanged(STATE_FILE, { lastProcessedTicker: selected.at(-1)?.ticker ?? null });
  }
  const result = reporter.summary();
  console.log(`[ done     ] ${result.updated} funds updated, ${result.failures} failures`);
  console.log(`[ done     ] counts: evaluated=${result.completed} unchanged=${result.unchanged} funds=${indexFunds.length} holdings=${totalHoldings} history=${totalHistory} index=${changed ? 'updated' : 'unchanged'}`);
}

if (import.meta.main) {
  main().catch(error => { console.error(`[ done     ] fatal: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
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
