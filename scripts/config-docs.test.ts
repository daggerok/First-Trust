/// <reference types="bun" />
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CONTROL_NAMES, readConfig, resolveControls, runtimeControls } from './update-data';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const file = JSON.parse(read('scripts/update-data.config.json'));

test('configuration precedence: file < advanced < nonblank input < environment', () => {
  const c = resolveControls({ CONCURRENCY: 2, TICKERS: 'FDN' }, { CONCURRENCY: 3, TICKERS: 'FTSM' }, { CONCURRENCY: '4', TICKERS: '' }, { FIRSTTRUST_CONCURRENCY: '5', CONCURRENCY: '6' });
  expect(c.CONCURRENCY).toBe('5');
  expect(c.TICKERS).toBe('FTSM');
  expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }, { CONCURRENCY: '4' }).CONCURRENCY).toBe('4');
  expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }).CONCURRENCY).toBe('3');
  expect(resolveControls({ CONCURRENCY: 2 }, {}, {}, { CONCURRENCY: '7' }).CONCURRENCY).toBe('7');
});

test('blank input inherits, advanced can deliberately blank a key, env can override booleans', () => {
  expect(resolveControls({ CONCURRENCY: 2 }, {}, { CONCURRENCY: '' }).CONCURRENCY).toBe('2');
  expect(resolveControls({ TICKERS: 'FDN' }, { TICKERS: '' }, { TICKERS: '' }).TICKERS).toBe('');
  expect(resolveControls({ SKIP_YAHOO: true }, {}, {}, { SKIP_YAHOO: 'false' }).SKIP_YAHOO).toBe('false');
  expect(resolveControls({ MAX_FETCHES: 0 }).MAX_FETCHES).toBe('0');
});

test('scheduled path (empty inputs and advanced) equals the config defaults', () => {
  const controls = resolveControls(file, {}, {}, {});
  expect(controls).toEqual(Object.fromEntries(Object.entries(file).map(([key, value]) => [key, String(value)])));
  const config = readConfig(controls);
  expect(config).toMatchObject({
    maxFetches: 0, requestSleep: 1, concurrency: 2, maxRetries: 2, holdingsPageSize: 250, historyPageSize: 1000,
    historyRange: 'max', tickers: [], edgarFallback: true, skipYahoo: false, performanceRanges: {}, totalReturnRanges: {},
  });
  expect(config.aumRange).toBeUndefined();
  expect(config.terRange).toBeUndefined();
});

test('SEC_UA default is a non-personal descriptor and the protected value overrides it', () => {
  expect(file.SEC_UA).toBe('daggerok First Trust ETF feed (https://github.com/daggerok/First-Trust)');
  expect(file.SEC_UA).not.toMatch(/@/);
  expect(resolveControls(file, {}, {}, { SEC_UA: 'Org Contact (ops@example.org)' }).SEC_UA).toBe('Org Contact (ops@example.org)');
});

test('resolver rejects unknown, non-scalar, multiline and invalid values', () => {
  for (const value of [{ UNKNOWN: 1 }, { SEC_UA: 'x\nEVIL=yes' }, { CONCURRENCY: 0 }, { MAX_RETRIES: 0 }, { MAX_FETCHES: 1.5 }, { MAX_FETCHES: -1 }, { REQUEST_SLEEP: '-1' }, { VERBOSE: 'maybe' }, { EDGAR_FALLBACK: 'later' }, { HISTORY_RANGE: 'forever' }, { AUM: '5B:1B' }, { TER: '5:1' }, { PERFORMANCE_1Y: '10' }, { TICKERS: ['FDN'] }, { TICKERS: { a: 1 } }, null, []]) {
    expect(() => resolveControls(value)).toThrow();
  }
  expect(() => resolveControls({}, { SEC_UA: 'x\rfoo' })).toThrow();
  expect(() => resolveControls({}, {}, { TICKERS: 'FDN\0' })).toThrow();
  expect(() => resolveControls({}, {}, {}, { FIRSTTRUST_SEC_UA: 'x\0bad' })).toThrow();
  expect(() => resolveControls({}, 'not an object')).toThrow();
  expect(() => resolveControls({}, [])).toThrow();
  expect(() => JSON.parse('{bad json')).toThrow();
});

test('runtimeControls reads the checked-in file and lets the environment win', async () => {
  const controls = await runtimeControls({ TICKERS: 'FDN FTSM', FIRSTTRUST_REQUEST_SLEEP: '0' });
  expect(controls.TICKERS).toBe('FDN FTSM');
  expect(controls.REQUEST_SLEEP).toBe('0');
  expect(controls.HISTORY_RANGE).toBe('max');
  expect(readConfig(controls).tickers).toEqual(['FDN', 'FTSM']);
});

test('config keys, CONTROL_NAMES, README rows and --help are in sync', () => {
  expect(Object.keys(file).sort()).toEqual([...CONTROL_NAMES].sort());
  expect(Object.values(file).every((value) => typeof value === 'string')).toBe(true);
  const doc = read('README.md');
  const usage = Bun.spawnSync(['bun', 'scripts/update-data.ts', '--help'], { cwd: new URL('..', import.meta.url).pathname }).stdout.toString();
  const rows = new Set<string>();
  for (const [, cell] of doc.matchAll(/^\| ((?:`[A-Z0-9_]+`(?:, )?)+) \|/gm)) for (const [, name] of cell.matchAll(/`([A-Z0-9_]+)`/g)) rows.add(name);
  for (const name of CONTROL_NAMES) {
    const tenor = name.match(/^(PERFORMANCE|TOTAL_RETURN)_(1Y|3Y|5Y|10Y)$/);
    expect(rows.has(name)).toBe(true);
    expect(usage).toContain(tenor ? `${tenor[1]}_YTD` : name);
  }
  expect([...rows].filter((name) => !(CONTROL_NAMES as readonly string[]).includes(name))).toEqual([]);
  expect(doc).toContain('scripts/update-data.config.json');
  expect(doc).toContain('file defaults < advanced JSON < nonblank inputs < protected Actions variable/env');
});

test('workflow resolves controls with the shared resolver and writes only api/firsttrust', () => {
  const workflow = read('.github/workflows/update-data.yml');
  const names = [...workflow.slice(workflow.indexOf('    inputs:'), workflow.indexOf('\npermissions:')).matchAll(/^      (\w+):$/gm)].map((m) => m[1]);
  expect(names.length).toBeLessThanOrEqual(25);
  expect(names).toContain('advanced');
  expect(workflow).toMatch(/advanced:\n(?:        .+\n)*?        default: '\{\}'/);
  for (const name of names.filter((n) => n !== 'advanced')) expect(CONTROL_NAMES).toContain(name.toUpperCase());
  expect(names).not.toContain('sec_ua');
  expect(names).not.toContain('output_dir');
  expect(workflow).toContain("cron: '0 0 * * 0'");
  expect(workflow).toContain('resolveControls(file, advanced, individual, protectedVars)');
  expect(workflow).toContain('PROTECTED_SEC_UA: ${{ vars.SEC_UA }}');
  expect(workflow).toContain('toJSON(inputs)');
  expect(workflow).not.toMatch(/\$\{\{\s*inputs\./);
  expect(workflow).not.toContain('bunx tsc');
  expect(workflow).toContain('name: Generate api/firsttrust static data');
  expect(workflow).toContain('git add api/firsttrust\n          if git diff --cached --quiet -- api/firsttrust');
  expect([...workflow.matchAll(/git add (\S+)/g)].map((m) => m[1])).toEqual(['api/firsttrust']);
});
