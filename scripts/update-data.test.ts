/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import {
  applyCatalogPerformance, publishedAsOf, stalestFirst, buildPages, configureSoftDeadline, main, configureRequestTimeout, pruneStalePages, setApiRoot, writeFileAtomic, catalogOnlyEntry, chartUrl, configureRequestLanes, emptyReturns, fetchWithRetry, firstTrustIsoDate,
  formatFrequencyPlaceholder, fundPasses, historySheetRows, historyStartDate, indexEntryFromMeta, mapReturnRow,
  mergeDistributionRows, metricsFromReturns, normalizePreviousRow, normalizeHistoryRange, RETURNS_BASIS, returnsProvenance, pageBasenames, parseAumRange, parseCatalogHtml, parseChart,
  parseDistributionHtml, parseEdgarAtomFilings, parseFundTickerMap, parseHiddenInputs, parseHoldingsHtml, parseNport,
  parsePerformanceNavHtml, parsePriceHistoryRows, parseRange, parseSummaryHtml, readConfig, readXlsxRows, returnForFilter,
  returnSlot, samePublishedContent, splitRowCells, summarizeDistributions, summaryValue, toNumber, withoutRunTimestamps,
  resolveYieldBasis, yieldBasisFromKind,
  CONTROL_NAMES, resolveControls, runtimeControls, isCertError, installSystemCa,
  type Fund, type YieldBasis,
} from './update-data';

// Fixtures below are trimmed verbatim fragments of the official ftportfolios.com pages (captured 2026-09-28).
const catalogHtml = `
<span id="ContentPlaceHolder1_etfsearch_ctl00_lblETFSectionTitle" style="color:White;font-size:10pt;">Alternative Funds</span></B></TD></TR></TABLE>
<table cellpadding="0" cellspacing="0" class="searchResults small" width="100%" border="0"> <tr> <th width="410" class="sortableColumn" onclick="sortFunds_ContentPlaceHolder1_etfsearch_ctl00('Name')" align="left">Fund Name <img src='/Common/Images/ig_tblSortAsc.gif' alt='Ascending sort' /></th> <th width="60" class="sortableColumn">Ticker<br />Symbol </th> <th width="60" class="sortableColumn">Inception<br />Date </th> <th width="45" class="sortableColumn" align="right">Close<br />NAV </th> <th width="70" class="sortableColumn">30-Day<br />SEC Yield<sup>1</sup> </th> <th width="70" class="sortableColumn">Unsubsidized<br />30-Day<br />SEC Yield<sup>2</sup> </th> <th width="70" class="sortableColumn">12-Month<br />Trailing Distribution<br />Rate<sup>3</sup> </th> <th width="50" class="sortableColumn">Yield<br />As Of<br />Date </th> <th width="35">Fact<br />Sheet</th> <th width="40">Summary<br />Prospectus</th> </tr>
<!-- <tr><td><a href='/Retail/Etf/EtfSummary.aspx?Ticker=JUNK'>template</a></td></tr> -->
<tr style='background-color: WhiteSmoke;'> <td> <a href='/Retail/Etf/EtfSummary.aspx?Ticker=FTHI'>First Trust BuyWrite Income ETF</a> </td> <td align="center"> FTHI </td> <td align="center"> 01/06/14 </td> <td align="right" style="padding-right: 2px;"> $23.72 </td> <td align="right" style="padding-right: 20px;"> 0.66% </td> <td align="right" style="padding-right: 20px;"> ------- </td> <!-- <td align="right" style="padding-right: 10px;"> <'%# GetSecurityYieldForDisplay(CType(Container.DataItem, ExchangeTradedFundSecurity).IndexYield)%> </td> --> <td align="right" style="padding-right: 10px;"> 8.86% </td> <td align="right" style="padding-right: 10px;"> 08/31/26 </td> <td align="center"> <a target='_blank' href='/Common/ContentFileLoader.aspx?ContentGUID=x'><img border='0' alt='Click here to download a Fact Sheet'></a> </td> </tr>
</table>
<span id="ContentPlaceHolder1_etfsearch_ctl05_lblETFSectionTitle" style="color:White;font-size:10pt;">Thematic Funds</span></B></TD></TR></TABLE>
<table cellpadding="0" cellspacing="0" class="searchResults small" width="100%" border="0"> <tr> <th width="410" class="sortableColumn" onclick="sortFunds_ContentPlaceHolder1_etfsearch_ctl00('Name')" align="left">Fund Name <img src='/Common/Images/ig_tblSortAsc.gif' alt='Ascending sort' /></th> <th width="60" class="sortableColumn">Ticker<br />Symbol </th> <th width="60" class="sortableColumn">Inception<br />Date </th> <th width="45" class="sortableColumn" align="right">Close<br />NAV </th> <th width="70" class="sortableColumn">30-Day<br />SEC Yield<sup>1</sup> </th> <th width="70" class="sortableColumn">Unsubsidized<br />30-Day<br />SEC Yield<sup>2</sup> </th> <th width="70" class="sortableColumn">12-Month<br />Trailing Distribution<br />Rate<sup>3</sup> </th> <th width="50" class="sortableColumn">Yield<br />As Of<br />Date </th> <th width="35">Fact<br />Sheet</th> <th width="40">Summary<br />Prospectus</th> </tr>
<tr style='background-color: WhiteSmoke;'> <td> <a href='/Retail/Etf/EtfSummary.aspx?Ticker=FDN'>First Trust Dow Jones Internet Index Fund</a> </td> <td align="center"> FDN </td> <td align="center"> 06/19/06 </td> <td align="right" style="padding-right: 2px;"> $291.54 </td> <td align="right" style="padding-right: 20px;"> ------- </td> <td align="right" style="padding-right: 20px;"> ------- </td> <!-- <td align="right"> <'%# GetSecurityYieldForDisplay()%> </td> --> <td align="right" style="padding-right: 10px;"> ------- </td> <td align="right" style="padding-right: 10px;"> ------- </td> </tr>
</table>`;
// etflist.aspx?DisplayType=PerformanceNav (net expense ratio of BFEW changed to exercise a waiver).
const performanceNavHtml = `
<span id="ContentPlaceHolder1_etfsearch_ctl00_lblETFSectionTitle" style="color:White;font-size:10pt;">Alternative Funds</span></B></TD></TR></TABLE>
<table cellpadding="0" cellspacing="0" class="searchResults small" width="100%" border="0"> <tr> <th width="250" class="sortableColumn" align="left">Fund Name <img src='/Common/Images/ig_tblSortAsc.gif' alt='Ascending sort' /></th> <th width="20" class="sortableColumn">Ticker<br />Symbol </th> <th width="45" class="sortableColumn">Inception<br />Date </th> <th width="45" class="sortableColumn">Total<br />Expense<br />Ratio </th> <th width="45" class="sortableColumn">Net<br />Expense<br />Ratio </th> <th width="40" class="sortableColumn">3<br />Month</th> <th width="40" class="sortableColumn">YTD</th> <th width="40" class="sortableColumn">1<br />Year</th> <th width="40" class="sortableColumn">3<br />Year</th> <th width="40" class="sortableColumn">5<br />Year</th> <th width="40" class="sortableColumn">10<br />Year</th> <th width="40" class="sortableColumn">Since<br />Inception</th> <th width="30" class="sortableColumn">As<br />Of<br />Date</th> <th width="30">Fact<br />Sheet</th> </tr>
<tr style='background-color: WhiteSmoke;'> <td> <a href='/Retail/Etf/EtfSummary.aspx?Ticker=FTHI'>First Trust BuyWrite Income ETF</a> </td> <td align="center"> FTHI </td> <td align="center"> 1/6/2014 </td> <td align="right"> 0.75% </td> <td align="right"> N/A </td> <td align="right"> 2.21% </td> <td align="right"> 6.87% </td> <td align="right"> 12.02% </td> <td align="right"> 13.80% </td> <td align="right"> 10.83% </td> <td align="right"> 8.36% </td> <td align="right"> 7.74% </td> <td align="center"> 8/31/2026 </td> <td align="center"> <a target='_blank' href='/Common/ContentFileLoader.aspx?ContentGUID=x'><img border='0' alt='Fact Sheet'></a> </td> </tr>
</table>
<span id="ContentPlaceHolder1_etfsearch_ctl07_lblETFSectionTitle" style="color:White;font-size:10pt;">Target Outcome Funds</span></B></TD></TR></TABLE>
<table cellpadding="0" cellspacing="0" class="searchResults small" width="100%" border="0"> <tr> <th width="250" class="sortableColumn" align="left">Fund Name <img src='/Common/Images/ig_tblSortAsc.gif' alt='Ascending sort' /></th> <th width="20" class="sortableColumn">Ticker<br />Symbol </th> <th width="45" class="sortableColumn">Inception<br />Date </th> <th width="45" class="sortableColumn">Total<br />Expense<br />Ratio </th> <th width="45" class="sortableColumn">Net<br />Expense<br />Ratio </th> <th width="40" class="sortableColumn">3<br />Month</th> <th width="40" class="sortableColumn">YTD</th> <th width="40" class="sortableColumn">1<br />Year</th> <th width="40" class="sortableColumn">3<br />Year</th> <th width="40" class="sortableColumn">5<br />Year</th> <th width="40" class="sortableColumn">10<br />Year</th> <th width="40" class="sortableColumn">Since<br />Inception</th> <th width="30" class="sortableColumn">As<br />Of<br />Date</th> <th width="30">Fact<br />Sheet</th> </tr>
<tr> <td> <a href='/Retail/Etf/EtfSummary.aspx?Ticker=BFEW'>FT Vest Laddered U.S. Equity Equal Weight Buffer ETF</a> </td> <td align="center"> BFEW </td> <td align="center"> 4/7/2026 </td> <td align="right"> 0.95% </td> <td align="right"> 0.85% </td> <td align="right"> 4.00% </td> <td align="right"> N/A </td> <td align="right"> N/A </td> <td align="right"> N/A </td> <td align="right"> N/A </td> <td align="right"> N/A </td> <td align="right"> 9.21% </td> <td align="center"> 8/31/2026 </td> <td></td> </tr>
</table>`;

const summaryHtml = `<html><head><title>
\tFirst Trust BuyWrite Income ETF (FTHI)
</title></head><body>
<table class="fundTable"><tr> <td class="CEFFieldLabel" valign="top">CUSIP</td><td class="CEFPagesBody" align="right">33738R308</td> </tr>
<tr> <td class="CEFFieldLabel" valign="top">ISIN</td><td class="CEFPagesBody" align="right">US33738R3084</td> </tr>
<tr> <td class="CEFFieldLabel" valign="top">Exchange</td><td class="CEFPagesBody" align="right">Nasdaq</td> </tr>
<tr> <td class="CEFFieldLabel" valign="top">Inception</td><td class="CEFPagesBody" align="right">1/6/2014</td> </tr>
<tr> <td class="CEFFieldLabel" valign="top">Total Expense Ratio*</td><td class="CEFPagesBody" align="right" valign="top">0.75%</td> </tr> </table>
<div id="FundOverview_FundControlContainer_divExpenseRatioDate" class="fundControlDisclaimer" style="margin-top: 2px;">* As of 5/1/2026</div>
<div class="fundControlHeaderBar">Current Fund Data (as of 9/25/2026)</div><div class="fundFundControlContainerMainContent">
<table class="fundTable" style="width:100%;"> <tr> <td class="CEFFieldLabel" valign="top" style="width:70%;">Closing NAV<sup>1</sup></td><td class="CEFPagesBody" align="right" valign="top" style="width:30%;">$23.72</td> </tr>
<tr> <td class="CEFFieldLabel" valign="top" style="width:70%;">Closing Market Price<sup>2</sup></td><td class="CEFPagesBody" align="right">$23.74</td> </tr>
<tr> <td class="CEFFieldLabel" valign="top" style="width:70%;">Bid/Ask Premium</td><td class="CEFPagesBody" align="right">0.06%</td> </tr>
<tr> <td class="CEFFieldLabel" valign="top" style="width:70%;">Total Net Assets</td><td class="CEFPagesBody" align="right">$2,537,507,391</td> </tr></table></div>
<table class="fundTable"> <tr> <td class="CEFFieldLabel" valign="top" style="width:75%;">30-Day SEC Yield <span style="font-size:8pt;">(as of 8/31/2026)</span><sup>6</sup></td><td class="CEFPagesBody" align="right">0.66%</td> </tr>
<tr> <td class="CEFFieldLabel" valign="top" style="width:75%;">12-Month Distribution Rate <span style="font-size:8pt;">(as of 8/31/2026)</span><sup>7</sup></td><td class="CEFPagesBody" align="right" valign="top" style="width:25%;">8.86%</td> </tr></table>
<div class="fundControlHeaderBar">Month End Performance (as of 8/31/2026)</div><div class="fundFundControlContainerMainContent"> <table width="100%" class="fundGrid" cellspacing="0"> <tr> <td bgcolor="white" width="180">&nbsp;</td> <td bgcolor="white" class="CEFFieldLabel" align="center" width="60"><b>3 Month</b></td> <td bgcolor="white" class="CEFFieldLabel"><b>YTD</b></td> <td bgcolor="white" class="CEFFieldLabel"><b>1 Year</b></td> <td bgcolor="white" class="CEFFieldLabel"><b>3 Year</b></td> <td bgcolor="white" class="CEFFieldLabel"><b>5 Year</b></td> <td bgcolor="white" class="CEFFieldLabel"><b>10 Year</b></td> <td bgcolor="white" class="CEFFieldLabel" align="center" width="60"><b>Since<br />Fund<br />Inception<sup>10</sup></b></td> </tr>
<tr> <td colspan="8" class="CEFFieldLabel" style="padding: 0px;"> <div class="silverBox fundControlSeperatorBar"> Fund Performance <span style="font-size: 12pt">*</span> </div> </td> </tr>
<tr> <td width="180" class="CEFPagesBody">Net Asset Value (NAV)</td> <td class="CEFPagesBody returnsRow" align="right">2.21%</td> <td class="CEFPagesBody returnsRow">6.87%</td> <td class="CEFPagesBody returnsRow">12.02%</td> <td class="CEFPagesBody returnsRow">13.80%</td> <td class="CEFPagesBody returnsRow">10.83%</td> <td class="CEFPagesBody returnsRow">8.36%</td> <td class="CEFPagesBody returnsRow">7.74%</td> </tr>
<tr> <td width="180" class="CEFPagesBody">Market Price</td> <td class="CEFPagesBody returnsRow">2.20%</td> <td class="CEFPagesBody returnsRow">6.91%</td> <td class="CEFPagesBody returnsRow">12.11%</td> <td class="CEFPagesBody returnsRow">13.79%</td> <td class="CEFPagesBody returnsRow">10.83%</td> <td class="CEFPagesBody returnsRow">8.36%</td> <td class="CEFPagesBody returnsRow">7.75%</td> </tr>
<tr> <td colspan="8" class="CEFFieldLabel" style="padding: 0px;"> <div class="silverBox" style="padding-left: 3px; height: 21px; line-height: 21px; font-weight: bold;"> Index Performance <span style="font-size: 12pt">**</span> </div> </td> </tr> <tr> <td width="180" class="CEFPagesBody">Cboe S&amp;P 500 BuyWrite Index<sup>SM</sup></td> <td class="CEFPagesBody returnsRow">1.90%</td> </tr></table></div>
<div class="fundControlHeaderBar">Quarter End Performance (as of 6/30/2026)</div><table width="100%" class="fundGrid" cellspacing="0"> <tr> <td>&nbsp;</td> <td><b>3 Month</b></td> <td><b>YTD</b></td> <td><b>1 Year</b></td> <td><b>3 Year</b></td> <td><b>5 Year</b></td> <td><b>10 Year</b></td> <td><b>Since<br />Fund<br />Inception</b></td> </tr>
<tr> <td class="CEFPagesBody">Net Asset Value (NAV)</td> <td>6.15%</td> <td>5.58%</td> <td>13.93%</td> <td>14.05%</td> <td>10.57%</td> <td>N/A</td> <td>7.75%</td> </tr></table>
</body></html>`;

const holdingsHeader = (columns: string[]): string => `<tr class="fundSilverGridHeader">${columns.map(name => `<td class="fundSilverGridHeader sortableColumn">${name} </td>`).join(' ')}</tr>`;
const equityHoldingsHtml = `<span id="ContentPlaceHolder1_HoldingsListing_lblHoldingsTitle" class="PageHeading">Holdings of the Fund as of 9/25/2026</span>
<table width="100%" cellspacing="0" rules="none" border="0" class="fundSilverGrid" style="border-collapse: collapse;">
${holdingsHeader(['Security Name', 'Identifier', 'CUSIP', 'Classification', 'Shares / Quantity', 'Market Value', 'Weighting'])}
<tr > <td>Meta Platforms, Inc. (Class A)</td> <td>META</td> <td>30303M102</td> <td>Communication Services</td> <td align="right">802,106</td> <td align="right">$602,910,995.96</td> <td align="right">11.36%</td> </tr>
<tr class='alternateFundSilverGridRow'> <td>Samsung Electro-Mechanics Co., Ltd.</td> <td>009150.KS</td> <td>Y7470U102</td> <td>Information Technology</td> <td>20,240</td> <td>$22,440,080.94</td> <td>1.64%</td> </tr>
<tr > <td>US Dollar</td> <td>$USD</td> <td></td> <td>Other</td> <td>4,479,160</td> <td>$4,479,159.67</td> <td>0.08%</td> </tr>
</table>`;
const optionsHoldingsHtml = `<span class="PageHeading">Holdings of the Fund as of 9/25/2026</span>
<table width="100%" cellspacing="0" rules="none" border="0" class="fundSilverGrid" style="border-collapse: collapse;">
${holdingsHeader(['Security Name', 'Identifier', 'CUSIP', 'Shares / Quantity', 'Market Value', 'Weighting'])}
<tr > <td>2027-01-15 State Street&reg; SPDR&reg; S&amp;P 500&reg; ETF Trust C 6.92</td> <td>4SPY  270115C00006920</td> <td></td> <td align="right">19,780</td> <td align="right">$1,507,870,740.20</td> <td align="right">101.29%</td> </tr>
<tr class='alternateFundSilverGridRow'> <td>2027-01-15 State Street® SPDR® S&P 500® ETF Trust P 622.49</td> <td>4SPY  270115P00622490</td> <td></td> <td>-19,780</td> <td>($5,630,772.60)</td> <td>-0.38%</td> </tr>
</table>`;
const bondHoldingsHtml = `<span class="PageHeading">Holdings of the Fund as of 9/25/2026</span>
<table class="fundSilverGrid">${holdingsHeader(['Security Name', 'Identifier', 'CUSIP', 'Shares / Quantity', 'Market Value', 'Weighting'])}
<tr><td>AUTONATION INC 0%, due 09/28/2026</td><td></td><td>05330NJU4</td><td>65,000,000</td><td>$65,000,000.00</td><td>0.99%</td></tr></table>`;

const distributionHtml = `<select name="ctl00$ContentPlaceHolder1$DistributionHistory$ddlDistributionHistoryYearSelection" id="ContentPlaceHolder1_DistributionHistory_ddlDistributionHistoryYearSelection">
<option value="2024">2024</option>
<option value="2025">2025</option>
<option selected="selected" value="2026">2026</option>
</select>
<table cellspacing="0" rules="none" border="0" class="fundSilverGrid" style="font-size: 9pt; border-collapse: collapse;">
<tr class="fundSilverGridHeader"><th class="first">Month</th><th>Ex-Date</th><th>Record Date</th><th>Payable Date</th><th>Distribution<br />Amount</th><th>Distribution Type<sup>1</sup></th></tr>
<tr ><td class="first">September</td><td>9/24/2026</td><td>9/24/2026</td><td>9/30/2026</td><td>$0.179000</td><td>Ordinary Distributions</td></tr>
<tr ><td class="first">August</td><td>8/21/2026</td><td>8/21/2026</td><td>8/31/2026</td><td>$0.179000</td><td>Ordinary Distributions</td></tr>
<tr ><td class="first">July</td><td>7/21/2026</td><td>7/21/2026</td><td>7/31/2026</td><td>$0.179000</td><td>Ordinary Distributions</td></tr>
</table>`;

// Minimal stored-deflate XLSX builder so the zero-dependency reader is exercised without a binary fixture.
function zip(files: Record<string, string>): Uint8Array {
  const locals: Uint8Array[] = [], centrals: Uint8Array[] = [];
  let offset = 0;
  const encoder = new TextEncoder();
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = encoder.encode(name), raw = encoder.encode(text), packed = deflateRawSync(raw);
    const local = new Uint8Array(30 + nameBytes.length + packed.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, 8, true); lv.setUint32(18, packed.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30); local.set(packed, 30 + nameBytes.length);
    const central = new Uint8Array(46 + nameBytes.length), cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, 8, true); cv.setUint32(20, packed.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, nameBytes.length, true); cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    locals.push(local); centrals.push(central); offset += local.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, centrals.length, true); ev.setUint16(10, centrals.length, true); ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) { out.set(part, at); at += part.length; }
  return out;
}
const priceXlsx = zip({
  'xl/sharedStrings.xml': '<sst><si><t>First Trust Dow Jones Internet Index Fund Price History from 6/19/2006 to 9/25/2026</t></si><si><t>Date</t></si><si><t>Market Price</t></si><si><t>Net Asset Value</t></si><si><t>Bid/Ask Midpoint</t></si><si><t>Volume</t></si><si><t>Net Assets</t></si><si><t>9/25/2026</t></si><si><t>9/24/2026</t></si></sst>',
  'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3" t="s"><v>2</v></c><c r="C3" t="s"><v>3</v></c><c r="D3" t="s"><v>4</v></c><c r="E3" t="s"><v>5</v></c><c r="F3" t="s"><v>6</v></c></row>'
    + '<row r="4"><c r="A4" t="s"><v>7</v></c><c r="B4"><v>291.61</v></c><c r="C4"><v>291.54</v></c><c r="D4"><v>291.55</v></c><c r="E4"><v>119017</v></c><c r="F4"><v>5306019723</v></c></row>'
    + '<row r="5"><c r="A5" t="s"><v>8</v></c><c r="B5"><v>292.55</v></c><c r="C5"><v>292.52</v></c><c r="E5"><v>178521</v></c><c r="F5"><v>5323945132</v></c></row></sheetData></worksheet>',
});

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const file = JSON.parse(read('scripts/update-data.config.json'));
const SEC_UA = 'daggerok ETF feed daggerok@gmail.com';

// Clean, portable environment for every test: no control variables from the shell or the workflow, fixed time zone,
// and everything a test may replace is restored afterwards.
const savedEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const originalLog = console.log;
beforeEach(() => {
  for (const key of Object.keys(process.env)) if ((CONTROL_NAMES as readonly string[]).includes(key) || key.startsWith('FIRSTTRUST_') || key === 'HISTORICAL_PAGE_SIZE') delete process.env[key];
  process.env.TZ = 'UTC';
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  console.log = originalLog;
  process.exitCode = 0;
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  configureRequestLanes(1, 0);
  configureRequestTimeout(45_000);
  configureSoftDeadline(25 * 60_000);
});

describe('controls', () => {
  test('strict ranges, AUM presets and HISTORY_RANGE validation', () => {
    expect(parseRange('0.2:2', 'TER')).toEqual({ min: 0.2, max: 2 });
    expect(parseRange(':', 'TER')).toBeUndefined();
    expect(parseRange('', 'TER')).toBeUndefined();
    expect(parseAumRange('10M:2B')).toMatchObject({ min: 10000000, max: 2000000000 });
    expect(parseAumRange('small')).toMatchObject({ min: 300000000, max: 2000000000 });
    expect(() => parseRange('1', 'TER')).toThrow('a colon is required');
    expect(() => parseRange('5:1', 'TER')).toThrow('must not exceed');
    expect(() => parseRange('a:1', 'TER')).toThrow('is not a number');
    expect(['max', '10y', 'MAX', ''].map(normalizeHistoryRange)).toEqual(['max', '10y', 'max', 'max']);
    for (const bad of ['6mo', 'forever', '0y', '-1y', '1.5y', '10']) expect(() => normalizeHistoryRange(bad)).toThrow('HISTORY_RANGE');
    expect(() => readConfig({ HISTORY_RANGE: '6mo' })).toThrow('HISTORY_RANGE');
    expect(() => resolveControls({}, {}, { HISTORY_RANGE: '6mo' }, {})).toThrow('HISTORY_RANGE');
  });

  test('resolver precedence: file < advanced < nonblank input < env, blanks and booleans', () => {
    const c = resolveControls({ CONCURRENCY: 2, TICKERS: 'FDN' }, { CONCURRENCY: 3, TICKERS: 'FTSM' }, { CONCURRENCY: '4', TICKERS: '' }, { FIRSTTRUST_CONCURRENCY: '5', CONCURRENCY: '6' });
    expect(c.CONCURRENCY).toBe('5');
    expect(c.TICKERS).toBe('FTSM');
    expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }, { CONCURRENCY: '4' }).CONCURRENCY).toBe('4');
    expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }).CONCURRENCY).toBe('3');
    expect(resolveControls({ CONCURRENCY: 2 }, {}, {}, { CONCURRENCY: '7' }).CONCURRENCY).toBe('7');
    expect(resolveControls({ CONCURRENCY: 2 }, {}, { CONCURRENCY: '' }).CONCURRENCY).toBe('2');
    expect(resolveControls({ TICKERS: 'FDN' }, { TICKERS: '' }, { TICKERS: '' }).TICKERS).toBe('');
    expect(resolveControls({ SKIP_YAHOO: true }, {}, {}, { SKIP_YAHOO: 'false' }).SKIP_YAHOO).toBe('false');
    expect(resolveControls({ MAX_FETCHES: 0 }).MAX_FETCHES).toBe('0');
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

  test('scheduled path equals the config defaults; SEC contact default and protected override', () => {
    expect(file.SEC_UA).toBe(SEC_UA);
    expect(resolveControls(file, {}, {}, { SEC_UA: 'Org Contact (ops@example.org)' }).SEC_UA).toBe('Org Contact (ops@example.org)');
    expect(readConfig({}).secUa).toBe(SEC_UA);
  });

  test('invalid values, unknown keys and CR/LF/NUL are errors, never silent fallbacks; explicit empty env clears', () => {
    expect(resolveControls({ TICKERS: 'FDN' }, {}, {}, { TICKERS: '' }).TICKERS).toBe('');
    expect(() => resolveControls({}, {}, {}, { MAX_RETRIES: '0' })).toThrow('MAX_RETRIES');
    expect(() => resolveControls({}, {}, {}, { CONCURRENCY: 'two' })).toThrow('CONCURRENCY');
    expect(() => resolveControls({}, {}, {}, { VERBOSE: 'maybe' })).toThrow('VERBOSE');
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

  test('conservative defaults and data filters on published values', () => {
    const config = readConfig({ TICKERS: 'fdn, ftsm;fjan', TER: ':0.6', FIRSTTRUST_PERFORMANCE_1Y: '10:', TOTAL_RETURN_3Y: '30:' });
    expect(config).toMatchObject({ requestSleep: 1, concurrency: 2, maxRetries: 2, maxFetches: 0, holdingsPageSize: 250, historyPageSize: 1000, historyRange: 'max', edgarFallback: true, skipYahoo: false, secUa: 'daggerok ETF feed daggerok@gmail.com' });
    expect(config.tickers).toEqual(['FDN', 'FTSM', 'FJAN']);
    expect(readConfig({ REQUEST_SLEEP: '', CONCURRENCY: '0', MAX_FETCHES: '0' })).toMatchObject({ requestSleep: 1, concurrency: 2, maxFetches: 0 });
    expect(readConfig({ REQUEST_SLEEP: '0' }).requestSleep).toBe(0);
    const base: Fund = { ...parseCatalogHtml(catalogHtml)[1], aumValue: 1e9 };
    const withReturns = (terValue: number | null, yr1: number | null, yr3: number | null): Fund => ({ ...base, terValue, returns: { monthEnd: { ...emptyReturns(), yr1, yr3 }, quarterEnd: null } });
    expect(fundPasses(withReturns(0.5, 12, 10), config)).toBe(true);
    expect(fundPasses(withReturns(0.75, 12, 10), config)).toBe(false);
    expect(fundPasses(withReturns(0.5, 5, 10), config)).toBe(false);
    expect(fundPasses(withReturns(0.5, 12, 8), config)).toBe(false);
    expect(fundPasses(withReturns(null, 12, 10), config)).toBe(false);
    expect(returnForFilter({ ...emptyReturns(), yr3: 10 }, '3Y', true)).toBe(33.1);
    expect(returnForFilter({ ...emptyReturns(), yr1: -4 }, '1Y', true)).toBe(-4);
    expect(returnForFilter(null, 'YTD', false)).toBeNull();
  });

  test('runtimeControls reads the checked-in file and brand env alias wins', async () => {
    const controls = await runtimeControls({ TICKERS: 'FDN FTSM', FIRSTTRUST_REQUEST_SLEEP: '0' });
    expect(controls.TICKERS).toBe('FDN FTSM');
    expect(controls.REQUEST_SLEEP).toBe('0');
    expect(controls.HISTORY_RANGE).toBe('max');
    expect(readConfig(controls).tickers).toEqual(['FDN', 'FTSM']);
  });

  test('config keys, CONTROL_NAMES, README rows and --help are in sync; USE_SYSTEM_CA modes', () => {
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
    expect(file.USE_SYSTEM_CA).toBe('auto');
    expect(resolveControls(file).USE_SYSTEM_CA).toBe('auto');
    for (const mode of ['auto', 'true', 'false']) expect(resolveControls(file, {}, {}, { USE_SYSTEM_CA: mode.toUpperCase() }).USE_SYSTEM_CA).toBe(mode);
    expect(() => resolveControls(file, {}, {}, { USE_SYSTEM_CA: 'maybe' })).toThrow('USE_SYSTEM_CA');
  });

});

describe('parsing', () => {
  test('catalog list: sections by header label, commented rows ignored, missing values null', () => {
    const funds = parseCatalogHtml(catalogHtml);
    expect(funds.map(fund => fund.ticker)).toEqual(['FDN', 'FTHI']);
    expect(funds[1]).toMatchObject({ name: 'First Trust BuyWrite Income ETF', category: 'Alternative', navValue: 23.72, secYield: 0.66, dividendYield: 8.86, unsubsidizedSecYield: null, inceptionListed: '2014-01-06', yieldAsOf: '2026-08-31' });
    expect(funds[0]).toMatchObject({ category: 'Thematic', dividendYield: null, secYield: null, aumValue: null, terValue: null, returns: null });
    expect(firstTrustIsoDate('08/31/26')).toBe('2026-08-31');
    expect(firstTrustIsoDate('12/21/99')).toBe('1999-12-21');
    expect(firstTrustIsoDate('9/25/2026')).toBe('2026-09-25');
  });

  test('return tenors map by header label; unavailable values become null, never 0', () => {
    const header = ['', '3 Month', 'YTD', '1 Year', '3 Year', '5 Year', '10 Year', 'Since Fund Inception'];
    expect(mapReturnRow(header, ['Net Asset Value (NAV)', '1%', '2%', '3%', '4%', '5%', '6%', '7%'], '2026-08-31'))
      .toEqual({ asOfDate: '2026-08-31', mo3: 1, ytd: 2, yr1: 3, yr3: 4, yr5: 5, yr10: 6, sinceInception: 7 });
    const reordered = ['Since Inception', '10 Year', 'Fund Name', '1 Year', 'YTD', '5 Year', '3 Year', '3 Month', 'As Of Date'];
    expect(mapReturnRow(reordered, ['7.5%', '-6.25%', 'Some Fund', '0.00%', '(1.10)', 'N/A', '', '—', '8/31/2026'], null))
      .toEqual({ asOfDate: null, mo3: null, ytd: -1.1, yr1: 0, yr3: null, yr5: null, yr10: -6.25, sinceInception: 7.5 });
    expect(mapReturnRow(['Unknown', 'Benchmark', 'YTD'], ['12%', 'S&P 500', '3%'], null)).toEqual({ ...emptyReturns(), ytd: 3 });
    expect(mapReturnRow(['YTD', '1 Year'], ['4%'], null)).toMatchObject({ ytd: 4, yr1: null });
    expect(['3 Month', 'YTD', '1 Year', '3 Year', '5 Year', '10 Year', 'Since Inception', 'Fund Name', 'As Of Date', 'Total Expense Ratio'].map(returnSlot))
      .toEqual(['mo3', 'ytd', 'yr1', 'yr3', 'yr5', 'yr10', 'sinceInception', null, null, null]);
    expect([toNumber('(5,630,772.60)'), toNumber('$1,234.5'), toNumber('0'), toNumber('-0.38%'), toNumber('-------'), toNumber('N/A'), toNumber(null)])
      .toEqual([-5630772.6, 1234.5, 0, -0.38, null, null, null]);
  });

  test('fund summary: name/value pairs, as-of dates, month and quarter-end NAV returns', () => {
    const summary = parseSummaryHtml(summaryHtml);
    expect(summary.name).toBe('First Trust BuyWrite Income ETF');
    expect(summary.navAsOf).toBe('2026-09-25');
    expect(summary.expenseAsOf).toBe('2026-05-01');
    expect(summary.benchmark).toBe('Cboe S&P 500 BuyWrite Index');
    expect(summaryValue(summary, 'Total Expense Ratio')?.value).toBe('0.75%');
    expect(summaryValue(summary, 'Closing NAV')?.value).toBe('$23.72');
    expect(summaryValue(summary, '12-Month Distribution Rate')).toEqual({ value: '8.86%', asOf: '2026-08-31' });
    expect(summary.monthEnd).toEqual({ asOfDate: '2026-08-31', mo3: 2.21, ytd: 6.87, yr1: 12.02, yr3: 13.8, yr5: 10.83, yr10: 8.36, sinceInception: 7.74 });
    expect(summary.quarterEnd).toMatchObject({ asOfDate: '2026-06-30', yr1: 13.93, yr10: null, sinceInception: 7.75 });
  });

  test('holdings: equity, international, cash, option and bond rows map to the Watchlist columns', () => {
    const equity = parseHoldingsHtml(equityHoldingsHtml);
    expect(equity.asOfDate).toBe('2026-09-25');
    expect(equity.rows).toEqual([
      { Name: 'Meta Platforms, Inc. (Class A)', Ticker: 'META', Identifier: '30303M102', Weight: '11.36', 'Market Value': '602910995.96', 'Shares Held': '802106', 'Asset Category': 'Communication Services' },
      { Name: 'Samsung Electro-Mechanics Co., Ltd.', Ticker: '009150.KS', Identifier: 'Y7470U102', Weight: '1.64', 'Market Value': '22440080.94', 'Shares Held': '20240', 'Asset Category': 'Information Technology' },
      { Name: 'US Dollar', Ticker: '-', Identifier: '$USD', Weight: '0.08', 'Market Value': '4479159.67', 'Shares Held': '4479160', 'Asset Category': 'Other' },
    ]);
    const options = parseHoldingsHtml(optionsHoldingsHtml).rows;
    expect(options[0]).toMatchObject({ Name: '2027-01-15 State Street SPDR S&P 500 ETF Trust C 6.92', Ticker: '-', Identifier: '4SPY 270115C00006920', Weight: '101.29', 'Asset Category': '-' });
    expect(options[1]).toMatchObject({ 'Market Value': '-5630772.6', 'Shares Held': '-19780', Weight: '-0.38' });
    expect(parseHoldingsHtml(bondHoldingsHtml).rows).toEqual([{ Name: 'AUTONATION INC 0%, due 09/28/2026', Ticker: '-', Identifier: '05330NJU4', Weight: '0.99', 'Market Value': '65000000', 'Shares Held': '65000000', 'Asset Category': '-' }]);
  });

  test('distributions: official columns, incremental year merge and cadence', () => {
    const page = parseDistributionHtml(distributionHtml);
    expect(page.years).toEqual([2024, 2025, 2026]);
    expect(page.selectedYear).toBe(2026);
    expect(page.headers).toEqual(['Ex-Date', 'Record Date', 'Payable Date', 'Distribution Amount', 'Distribution Type']);
    expect(page.rows[0]).toEqual(['2026-09-24', '2026-09-24', '2026-09-30', '0.179000', 'Ordinary Distributions']);
    const previous = [['2026-07-21', '2026-07-21', '2026-07-31', '0.170000', 'Ordinary Distributions'], ['2019-12-13', '2019-12-16', '2019-12-31', '0.080000', 'Ordinary Distributions']];
    const merged = mergeDistributionRows(page.rows, previous, new Set([2026]));
    expect(merged.map(row => row[0])).toEqual(['2026-09-24', '2026-08-21', '2026-07-21', '2019-12-13']);
    expect(merged[2][3]).toBe('0.179000');
    expect(summarizeDistributions(merged, new Date('2026-09-28T00:00:00Z'))).toEqual({ frequency: 'Monthly', latest: 0.179, exDate: '2026-09-24' });
    const stale = [['2011-12-21', '', '', '0.011100', 'Ordinary Distributions'], ['2011-06-21', '', '', '0.011400', 'Ordinary Distributions']];
    expect(summarizeDistributions(stale, new Date('2026-09-28T00:00:00Z'))).toEqual({ frequency: null, latest: 0.0111, exDate: '2011-12-21' });
    expect(summarizeDistributions([['2026-06-20', '', '', '0.2', 'Ordinary Distributions'], ['2025-12-20', '', '', '0.2', 'Ordinary Distributions'], ['2025-12-20', '', '', '1.5', 'Long-Term Capital Gain']], new Date('2026-09-28T00:00:00Z')).frequency).toBe('Semi-annually');
  });

  test('hidden form fields and the official price-history Excel export', () => {
    const form = parseHiddenInputs('<input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="a&amp;b" /><input type="hidden" name="ctl00$ContentPlaceHolder1$PriceHistory$txtMinDate" value="6/19/2006" /><input type="text" name="q" value="x" />');
    expect(form).toEqual({ __VIEWSTATE: 'a&b', 'ctl00$ContentPlaceHolder1$PriceHistory$txtMinDate': '6/19/2006' });
    const grid = readXlsxRows(priceXlsx);
    expect(grid[1]).toEqual(['Date', 'Market Price', 'Net Asset Value', 'Bid/Ask Midpoint', 'Volume', 'Net Assets']);
    const days = parsePriceHistoryRows(grid);
    expect(days).toEqual([
      { date: '2026-09-24', nav: 292.52, market: 292.55, netAssets: 5323945132 },
      { date: '2026-09-25', nav: 291.54, market: 291.61, netAssets: 5306019723 },
    ]);
    expect(historySheetRows(days)[1]).toEqual({ Date: '2026-09-25', NAV: '291.54', 'Market Price': '291.61', 'Premium/Discount': '0.0240%', 'Total Net Assets': '5306019723' });
    expect(historyStartDate('max', '6/19/2006', '9/25/2026')).toBe('2006-06-19');
    expect(historyStartDate('1y', '6/19/2006', '9/25/2026')).toBe('2025-09-25');
    expect(historyStartDate('10y', '1/5/2021', '9/25/2026')).toBe('2021-01-05');
  });

  test('Yahoo fallback chart: daily closes, adjusted close and dividends', () => {
    const chart = parseChart({ chart: { result: [{ meta: { longName: 'FT', regularMarketPrice: 23.7 }, timestamp: [1758672000, 1758758400], indicators: { quote: [{ close: [23.7000004, 23.745], volume: [100, null] }], adjclose: [{ adjclose: [23.6912, 23.7449] }] }, events: { dividends: { 1758672000: { date: 1758672000, amount: 0.179 } } } }] } });
    expect(chart.days).toEqual([
      { date: '2025-09-24', close: 23.7, adjClose: 23.69, volume: 100 },
      { date: '2025-09-25', close: 23.745, adjClose: 23.74, volume: 0 },
    ]);
    expect(chart.dividends).toEqual([{ epoch: 1758672000, amount: 0.179 }]);
  });

  test('SEC fund symbols and N-PORT-P fallback positions without inventing exchange tickers', () => {
    const refs = parseFundTickerMap({ fields: ['cik', 'seriesId', 'classId', 'symbol'], data: [[1329377, 's000012345', 'C000033333', 'fdn'], [1383496, 'S000099999', 'C000011111', 'FXL']] });
    expect(refs.get('FDN')).toEqual({ cik: '0001329377', seriesId: 'S000012345', classId: 'C000033333' });
    expect(refs.get('FXL')?.cik).toBe('0001383496');
    expect(parseEdgarAtomFilings('<entry><filing-type>NPORT-P</filing-type><accession-number>0001445546-26-001234</accession-number><filing-date>2026-08-28</filing-date><period>2026-06-30</period><filing-href>https://www.sec.gov/Archives/edgar/data/1329377/000144554626001234/</filing-href></entry><entry><filing-type>N-CSR</filing-type><accession-number>x</accession-number></entry>')).toEqual([
      { accession: '0001445546-26-001234', filed: '2026-08-28', reportDate: '2026-06-30', url: 'https://www.sec.gov/Archives/edgar/data/1329377/000144554626001234/primary_doc.xml' },
    ]);
    const nport = parseNport('<genInfo><regName>First Trust Exchange-Traded Fund</regName><regCik>0001329377</regCik><seriesId>S000012345</seriesId><repPdDate>2026-06-30</repPdDate></genInfo><fundInfo><netAssets>5306019723</netAssets></fundInfo><invstOrSec><name>Meta Platforms Inc</name><cusip>30303M102</cusip><balance>802106</balance><valUSD>602910995.96</valUSD><pctVal>11.36</pctVal><assetCat>EC</assetCat></invstOrSec>');
    expect(nport).toMatchObject({ regCik: '0001329377', seriesId: 'S000012345', repPdDate: '2026-06-30', netAssets: 5306019723 });
    expect(nport.holdings).toEqual([
      { Name: 'Meta Platforms Inc', Ticker: '-', Identifier: '30303M102', Weight: '11.36', 'Market Value': '602910995.96', 'Shares Held': '802106', 'Asset Category': 'EC' },
    ]);
  });

  test('frequency placeholder keeps None and Unknown distinct', () => {
    for (const missing of [null, undefined, '', '  ', '-', '—']) expect(formatFrequencyPlaceholder(missing)).toBe('00 - None');
    expect(formatFrequencyPlaceholder('none')).toBe('00 - None');
    expect(formatFrequencyPlaceholder('unknown')).toBe('00 - Unknown');
    expect(formatFrequencyPlaceholder('Monthly')).toBe('01 - Monthly');
    expect(formatFrequencyPlaceholder('Semi-annually')).toBe('06 - Semi-annually');
  });

});

describe('metrics', () => {
  test('TER gross/net mapping, catalog-only row, shared key set, dataFile null and old-row normalization', () => {
    const performance = parsePerformanceNavHtml(performanceNavHtml);
    expect([...performance.keys()]).toEqual(['FTHI', 'BFEW']);
    expect(performance.get('FTHI')).toEqual({
      inception: '2014-01-06', grossExpenseRatio: 0.75, netExpenseRatio: null,
      monthEnd: { asOfDate: '2026-08-31', mo3: 2.21, ytd: 6.87, yr1: 12.02, yr3: 13.8, yr5: 10.83, yr10: 8.36, sinceInception: 7.74 },
    });
    expect(performance.get('BFEW')).toMatchObject({ grossExpenseRatio: 0.95, netExpenseRatio: 0.85, monthEnd: { mo3: 4, ytd: null, yr1: null, yr10: null, sinceInception: 9.21 } });
    const [fdn, fthi] = parseCatalogHtml(catalogHtml);
    applyCatalogPerformance(fthi, performance.get('FTHI'));
    applyCatalogPerformance(fdn, performance.get('FDN'));
    expect(fthi).toMatchObject({ terValue: 0.75, netExpenseRatio: null, returns: { monthEnd: { yr1: 12.02 }, quarterEnd: null } });
    expect(fdn).toMatchObject({ terValue: null, returns: null });
    const entry = catalogOnlyEntry(fthi);
    expect(entry).toMatchObject({ ter: '0.75%', terValue: 0.75, inceptionDate: 'Jan 06 2014', holdings: 0, history: 0 });
    expect(entry.returns.monthEnd).toMatchObject({ asOfDate: 'Aug 31 2026', ytd: 6.87 });
    expect(entry.metrics).toMatchObject({ tr1y: 12.02, tr3y: 47.38, cagr5y: 10.83, dividendYield: 8.86, secYieldText: '0.66%' });
    expect(Object.keys(entry.metrics).slice(-2)).toEqual(['returnsBasis', 'performanceAsOf']);
    expect(entry.metrics).toMatchObject({ returnsBasis: RETURNS_BASIS, performanceAsOf: '2026-08-31' });
    // No meta.json exists for a catalog-only row: the hub must see dataFile null, not a dead link.
    expect(entry.dataFile).toBeNull();
    // Same metrics key set as the sibling feeds, ytd included.
    expect(Object.keys(entry.metrics)).toEqual(['ytd', 'tr1y', 'tr3y', 'tr5y', 'tr10y', 'cagr3y', 'cagr5y', 'cagr10y', 'siAnn', 'dividendYield', 'dividendYieldText', 'dividendYieldBasis', 'secYield', 'secYieldText', 'returnsBasis', 'performanceAsOf']);
    expect(entry.metrics.ytd).toBe(6.87);
    // A previously published row without ytd (old shape) is brought to the current key set and keeps a real dataFile only when meta.json exists.
    const old = { ...entry, dataFile: './funds/FTHI/meta.json', metrics: { tr1y: 12.02, dividendYield: 8.86 } };
    expect(normalizePreviousRow(old, true)).toMatchObject({ dataFile: './funds/FTHI/meta.json', metrics: { ytd: 6.87, tr1y: 12.02, cagr5y: 10.83 } });
    expect(normalizePreviousRow(old, false).dataFile).toBeNull();
  });

  test('cumulative total returns derive from annualized tenors; too-young horizons stay null', () => {
    const metrics = metricsFromReturns({ asOfDate: null, mo3: 1, ytd: 2, yr1: 10, yr3: 10, yr5: 10, yr10: null, sinceInception: 8 });
    expect(metrics).toMatchObject({ tr1y: 10, tr3y: 33.1, tr5y: 61.05, tr10y: null, cagr3y: 10, siAnn: 8 });
  });

  test('a young fund with only 3-month and since-inception data has null (not 0) for every longer horizon', () => {
    const metrics = metricsFromReturns({ ...emptyReturns('2026-08-31'), mo3: 4, sinceInception: 9.21 });
    for (const key of ['ytd', 'tr1y', 'tr3y', 'tr5y', 'tr10y', 'cagr3y', 'cagr5y', 'cagr10y']) expect(metrics[key]).toBeNull();
    expect(metrics.siAnn).toBe(9.21);
  });

  test('returnsBasis and performanceAsOf travel together: basis always set, date ISO or null', () => {
    expect(RETURNS_BASIS).toMatch(/official First Trust NAV/);
    expect(returnsProvenance({ ...emptyReturns('2026-08-31') })).toEqual({ returnsBasis: RETURNS_BASIS, performanceAsOf: '2026-08-31' });
    expect(returnsProvenance(emptyReturns('Aug 31 2026'))).toEqual({ returnsBasis: RETURNS_BASIS, performanceAsOf: null });
    expect(returnsProvenance(emptyReturns())).toEqual({ returnsBasis: RETURNS_BASIS, performanceAsOf: null });
  });

  test('index entry from fund meta keeps the shared sibling schema and the same metrics key set', () => {
    const fund = { ...parseCatalogHtml(catalogHtml)[1] };
    const summary = parseSummaryHtml(summaryHtml);
    const entry = indexEntryFromMeta(fund, {
      nav: { value: 23.72, asOfDate: 'Sep 25 2026' }, marketPrice: { value: 23.74 }, aum: { value: 2537507391 }, expenseRatio: { value: 0.75 },
      identifiers: { cusip: '33738R308', isin: 'US33738R3084' }, inception: { fundInceptionDate: '2014-01-06', exchange: 'Nasdaq' }, premiumDiscount: { value: 0.06 },
      returns: { monthEnd: summary.monthEnd, quarterEnd: summary.quarterEnd }, yields: { dividendYield: 8.86, secYield: 0.66 },
      distributions: { frequency: 'Monthly', latestAmount: 0.179, latestExDate: '2026-09-24' }, holdings: { totalRows: 193 }, history: { totalRows: 3199 },
    });
    expect(entry).toMatchObject({
      ticker: 'FTHI', fundPage: 'https://www.ftportfolios.com/Retail/Etf/EtfSummary.aspx?Ticker=FTHI', dataFile: './funds/FTHI/meta.json',
      ter: '0.75%', terValue: 0.75, nav: '$23.72', aum: '$2.54B', aumValue: 2537507391, inceptionDate: 'Jan 06 2014', exchange: 'Nasdaq', closePrice: '$23.74',
      premiumDiscount: '0.06%', distributions: { frequency: 'Monthly', exDate: 'Sep 24 2026', dividend: 0.179 }, holdings: 193, history: 3199,
    });
    expect(entry.returns).toMatchObject({ monthEnd: { asOfDate: 'Aug 31 2026', ytd: 6.87, sinceInception: 7.74 } });
    expect(entry.metrics).toMatchObject({ tr1y: 12.02, cagr5y: 10.83, dividendYield: 8.86, dividendYieldText: '8.86%', secYieldText: '0.66%' });
    // performanceAsOf is the performance table date (Aug 31), never the NAV date (Sep 25)
    expect(Object.keys(entry.metrics).slice(-2)).toEqual(['returnsBasis', 'performanceAsOf']);
    expect(entry.metrics).toMatchObject({ returnsBasis: RETURNS_BASIS, performanceAsOf: '2026-08-31' });
  });

  test('dividendYieldBasis: one code per yield source, null with a null yield, the same key set on fresh, rebuilt, retained and placeholder rows', () => {
    const [fdn, fthi] = parseCatalogHtml(catalogHtml);
    // catalog rate (12-Month Trailing Distribution Rate column) and an empty catalog cell
    expect(fthi).toMatchObject({ dividendYield: 8.86, dividendYieldBasis: 'official-trailing-12m' });
    expect(fdn).toMatchObject({ dividendYield: null, dividendYieldBasis: null });
    const placeholder = catalogOnlyEntry(fthi);
    expect(placeholder.metrics.dividendYieldBasis).toBe('official-trailing-12m');
    expect(catalogOnlyEntry(fdn).metrics).toMatchObject({ dividendYield: null, dividendYieldBasis: null });
    // rebuilt from meta: stored code, kind text of every source, and a null yield
    const base = { returns: { monthEnd: parseSummaryHtml(summaryHtml).monthEnd, quarterEnd: null }, holdings: { totalRows: 1 }, history: { totalRows: 1 } };
    const kinds: [string, YieldBasis][] = [
      ['First Trust published 12-month distribution rate as of Aug 31 2026', 'official-trailing-12m'],
      ['First Trust ETF list 12-month trailing distribution rate as of Aug 31 2026', 'official-trailing-12m'],
      ['Indicated from the latest ordinary distribution per share x inferred payments per year / market price', 'indicated'],
      ['First Trust something new', 'official-other'],
      ['some other wording', 'indicated'],
    ];
    const rebuilt = [{ yields: { dividendYield: 8.86, dividendYieldBasis: 'indicated' } }, { yields: { dividendYield: null, dividendYieldBasis: 'indicated' } }, { yields: {} },
      ...kinds.map(([kind]) => ({ yields: { dividendYield: 5, dividendYieldKind: kind } })), { yields: { dividendYield: 5 } }]
      .map((meta) => indexEntryFromMeta({ ...fthi }, { ...base, ...meta }));
    expect(rebuilt.map((row) => row.metrics.dividendYieldBasis)).toEqual(['indicated', null, null, ...kinds.map(([, code]) => code), 'official-other']);
    for (const [kind, code] of kinds) expect(yieldBasisFromKind(kind)).toBe(code);
    expect(resolveYieldBasis(0, null, 'First Trust published 12-month distribution rate')).toBe('official-trailing-12m');
    expect(resolveYieldBasis(null, 'indicated')).toBeNull();
    const keys = Object.keys(placeholder.metrics);
    for (const row of rebuilt) expect(Object.keys(row.metrics)).toEqual(keys);
    // retained rows: legacy row without the key gets it (kind text of the same yield decides), a stale code never outlives its yield
    const legacy = { ...placeholder, dataFile: './funds/FTHI/meta.json', metrics: { tr1y: 12.02, dividendYield: 8.86, dividendYieldText: '8.86%' } };
    const withMeta = normalizePreviousRow(legacy, true, { yields: { dividendYield: 8.86, dividendYieldKind: kinds[2][0] } });
    expect(withMeta.metrics.dividendYieldBasis).toBe('indicated');
    expect(Object.keys(withMeta.metrics).indexOf('dividendYieldBasis')).toBe(Object.keys(withMeta.metrics).indexOf('dividendYieldText') + 1);
    const otherYield = normalizePreviousRow(legacy, true, { yields: { dividendYield: 7, dividendYieldKind: kinds[2][0] } });
    expect(otherYield.metrics.dividendYieldBasis).toBe('official-other');
    expect(normalizePreviousRow({ ...legacy, metrics: { ...legacy.metrics, dividendYield: null, dividendYieldBasis: 'indicated' } }, false).metrics.dividendYieldBasis).toBeNull();
    expect(normalizePreviousRow(legacy, false).metrics).toHaveProperty('dividendYieldBasis', 'official-other');
  });

  test('catalog-only and full rows expose exactly the same metrics keys', () => {
    const [, fthi] = parseCatalogHtml(catalogHtml);
    const catalogOnly = catalogOnlyEntry(fthi);
    const full = indexEntryFromMeta({ ...fthi }, { returns: { monthEnd: parseSummaryHtml(summaryHtml).monthEnd, quarterEnd: null }, yields: {}, holdings: { totalRows: 1 }, history: { totalRows: 1 } });
    expect(Object.keys(full.metrics)).toEqual(Object.keys(catalogOnly.metrics));
  });

});

// ---------------------------------------------------------------------------
// End-to-end runs against a mocked network in a temp feed directory
// ---------------------------------------------------------------------------

type MockOptions = { catalog?: string; failFor?: { summary?: string[]; holdings?: string[]; history?: string[] }; delayMs?: number; failAll?: boolean; onSummary?: () => void };

function chartJson(close: number): string {
  const timestamps = [1790208000, 1790294400, 1790380800]; // 2026-09-24 .. 2026-09-26
  return JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: close, regularMarketTime: timestamps[2], firstTradeDate: 1389000000 }, timestamp: timestamps,
    indicators: { quote: [{ close: [close - 2, close - 1, close], volume: [10, 20, 30] }], adjclose: [{ adjclose: [close - 2, close - 1, close] }] } }] } });
}

function installMockNetwork(options: MockOptions = {}): { stats: { peak: number; calls: number; summaries: string[] }; restore: () => void } {
  const original = globalThis.fetch;
  const stats = { peak: 0, calls: 0, summaries: [] as string[] };
  let inFlight = 0;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    const ticker = /Ticker=([A-Z]+)/.exec(url)?.[1] ?? /chart\/([A-Z]+)/.exec(url)?.[1] ?? '';
    stats.calls += 1; inFlight += 1; stats.peak = Math.max(stats.peak, inFlight);
    try {
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      if (options.failAll) return new Response('down', { status: 404 });
      if (url.includes('DisplayType=PerformanceNav')) return new Response(performanceNavHtml);
      if (url.includes('etflist.aspx')) return new Response(options.catalog ?? catalogHtml);
      if (url.includes('EtfSummary')) { stats.summaries.push(ticker); options.onSummary?.(); }
      if (url.includes('EtfSummary')) return options.failFor?.summary?.includes(ticker) ? new Response('x', { status: 404 }) : new Response(summaryHtml);
      if (url.includes('EtfHoldings')) return options.failFor?.holdings?.includes(ticker) ? new Response('x', { status: 404 }) : new Response(equityHoldingsHtml);
      if (url.includes('EtfDividHistory')) return new Response(distributionHtml);
      if (url.includes('EtfPriceHistory')) return new Response('no export', { status: 404 });
      if (url.includes('finance.yahoo.com')) return options.failFor?.history?.includes(ticker) ? new Response('x', { status: 404 }) : new Response(chartJson(ticker === 'FDN' ? 291.5 : 23.7));
      return new Response('unexpected', { status: 404 });
    } finally {
      inFlight -= 1;
    }
  }) as unknown as typeof fetch;
  return { stats, restore: () => { globalThis.fetch = original; } };
}

function snapshotTree(dir: string, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir).sort()) {
    const full = `${dir}/${name}`;
    if (statSync(full).isDirectory()) Object.assign(out, snapshotTree(full, `${prefix}${name}/`));
    else out[`${prefix}${name}`] = readFileSync(full, 'utf8');
  }
  return out;
}


const baseEnv = { USE_SYSTEM_CA: 'false', REQUEST_SLEEP: '0', MAX_RETRIES: '1', CONCURRENCY: '2', EDGAR_FALLBACK: 'false', TICKERS: '', MAX_FETCHES: '0' };
const withFeed = async (work: (root: string) => Promise<void>): Promise<void> => {
  const root = mkdtempSync(join(tmpdir(), 'ft-run-'));
  console.log = () => undefined;
  try {
    setApiRoot(pathToFileURL(`${root}/`));
    await work(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};
const readIndex = (root: string): any => JSON.parse(readFileSync(`${root}/index.json`, 'utf8'));

describe('pipeline', () => {
  test('a second identical run writes nothing (zero diff) and lists every fund with its meta file', async () => {
    await withFeed(async (root) => {
      const net = installMockNetwork();
      try {
        expect(await main(baseEnv)).toMatchObject({ updated: 2, failures: 0 });
        const index = readIndex(root);
        expect(index.funds.map((fund: any) => fund.ticker)).toEqual(['FDN', 'FTHI']);
        expect(index.funds.every((fund: any) => fund.dataFile === `./funds/${fund.ticker}/meta.json` && 'ytd' in fund.metrics)).toBe(true);
        for (const fund of index.funds) expect(fund.metrics.dividendYieldBasis).toBe(fund.metrics.dividendYield === null ? null : 'official-trailing-12m');
        expect(readdirSync(`${root}/funds/FTHI`).sort()).toEqual(['history', 'holdings', 'meta.json']);
        const before = snapshotTree(root);
        // Run timestamps have one-second granularity: cross a second boundary so a missing zero-diff check cannot hide.
        await new Promise((resolve) => setTimeout(resolve, 1020 - (Date.now() % 1000)));
        await main(baseEnv);
        expect(snapshotTree(root)).toEqual(before);
      } finally {
        net.restore();
      }
    });
  });

  test('a one-ticker run keeps every row and fund file; catalog-only funds have dataFile null; cursor untouched', async () => {
    await withFeed(async (root) => {
      let net = installMockNetwork();
      try {
        await main(baseEnv);
        const before = snapshotTree(root);
        const withNew = catalogHtml.replaceAll('FDN', 'NEWT');
        net.restore();
        net = installMockNetwork({ catalog: withNew });
        const run = await main({ ...baseEnv, TICKERS: 'FTHI', MAX_FETCHES: '1' });
        expect(run.newFunds).toEqual(['NEWT']);
        const index = readIndex(root);
        expect(index.funds.map((fund: any) => fund.ticker)).toEqual(['FDN', 'FTHI', 'NEWT']);
        expect(index.funds.find((fund: any) => fund.ticker === 'FDN').dataFile).toBe('./funds/FDN/meta.json');
        const fresh = index.funds.find((fund: any) => fund.ticker === 'NEWT');
        expect(fresh.dataFile).toBeNull();
        expect(Object.keys(fresh.metrics)).toContain('ytd');
        expect(existsSync(`${root}/funds/NEWT`)).toBe(false);
        const after = snapshotTree(root);
        for (const path of Object.keys(before).filter((name) => name.startsWith('funds/FDN/'))) expect(after[path]).toBe(before[path]);
        expect(after['update-state.json']).toBe(before['update-state.json']);
        // The cursor file of a bounded run is not touched by a later TICKERS run.
        await main({ ...baseEnv, MAX_FETCHES: '1' });
        const state = readFileSync(`${root}/update-state.json`, 'utf8');
        expect(JSON.parse(state).cursor).not.toBeNull();
        await main({ ...baseEnv, TICKERS: 'FTHI' });
        expect(readFileSync(`${root}/update-state.json`, 'utf8')).toBe(state);
      } finally {
        net.restore();
      }
    });
  });

  test('a failed source keeps the fund exactly as published; all funds failing reports zero updated', async () => {
    await withFeed(async (root) => {
      let net = installMockNetwork();
      try {
        await main(baseEnv);
        const before = snapshotTree(root);
        net.restore();
        net = installMockNetwork({ failFor: { holdings: ['FTHI'], history: ['FDN'] } });
        const run = await main(baseEnv);
        expect(run).toMatchObject({ updated: 0, failures: 2 });
        expect(snapshotTree(root)).toEqual(before);
        net.restore();
        net = installMockNetwork({ failFor: { summary: ['FDN'] } });
        expect(await main(baseEnv)).toMatchObject({ updated: 1, failures: 1 });
        net.restore();
        net = installMockNetwork({ failAll: true });
        expect(await main(baseEnv)).toMatchObject({ updated: 0, failures: 2 });
        expect(snapshotTree(root)['funds/FDN/meta.json']).toBe(before['funds/FDN/meta.json']);
      } finally {
        net.restore();
      }
    });
  });

  test('stalest fund first: a deadline-truncated run refreshes the stalest, the next runs pick up the skipped funds', async () => {
    await withFeed(async (root) => {
      // a 3-fund catalog: ETHR, FDN, FTHI
      const catalog3 = `${catalogHtml}\n${catalogHtml.split('\n').filter((line) => line.includes('Ticker=FDN')).join('\n').replaceAll('FDN', 'ETHR')}`;
      let clock = Date.now();
      const realNow = Date.now;
      let net = installMockNetwork({ catalog: catalog3 });
      try {
        expect((await main({ ...baseEnv, CONCURRENCY: '1' })).updated).toBe(3);
        // published as-of dates: FTHI stalest, then ETHR, then FDN (alphabetical order would be ETHR, FDN, FTHI)
        const asOf: Record<string, [string, string]> = { FTHI: ['Jan 10 2026', '2026-01-10'], ETHR: ['Feb 10 2026', '2026-02-10'], FDN: ['Mar 01 2026', '2026-03-01'] };
        const index = readIndex(root);
        expect(index.funds.map((fund: any) => fund.ticker)).toEqual(['ETHR', 'FDN', 'FTHI']);
        for (const row of index.funds) { row.asOfDate = asOf[row.ticker][0]; row.metrics.performanceAsOf = asOf[row.ticker][1]; }
        writeFileSync(`${root}/index.json`, JSON.stringify(index));
        const published = new Map<string, any>(index.funds.map((row: any) => [row.ticker, row]));
        expect(stalestFirst(['ETHR', 'FDN', 'FTHI', 'ZNEW'].map((ticker) => ({ ticker })), published).map((fund) => fund.ticker)).toEqual(['ZNEW', 'FTHI', 'ETHR', 'FDN']);
        expect(publishedAsOf({ ...index.funds[0], dataFile: null })).toBeNull();
        net.restore();

        // fake clock: every fund summary request "takes" 2 minutes against a 1 minute soft deadline, so each run handles exactly one fund
        const summary = `${root}.summary.md`;
        Date.now = () => clock;
        net = installMockNetwork({ catalog: catalog3, onSummary: () => { clock += 120_000; } });
        const order: string[][] = [];
        for (let run = 0; run < 3; run += 1) {
          net.stats.summaries.length = 0;
          configureSoftDeadline(60_000);
          expect(await main({ ...baseEnv, CONCURRENCY: '1', GITHUB_STEP_SUMMARY: summary })).toMatchObject({ updated: 1, stoppedAtDeadline: true });
          order.push([...net.stats.summaries]);
        }
        expect(order).toEqual([['FTHI'], ['ETHR'], ['FDN']]);
        expect(readFileSync(summary, 'utf8')).toContain('1 of 3 funds refreshed, 2 keep their published state, oldest remaining published as-of: 2026-02-10 (ETHR)');
        expect(readIndex(root).funds.map((fund: any) => fund.ticker)).toEqual(['ETHR', 'FDN', 'FTHI']);
        expect(JSON.parse(readFileSync(`${root}/update-state.json`, 'utf8')).cursor).toBeNull();
        rmSync(summary, { force: true });
        // a run with room left finishes every fund and reports no deadline
        configureSoftDeadline(25 * 60_000);
        expect(await main({ ...baseEnv, CONCURRENCY: '1' })).toMatchObject({ updated: 3, stoppedAtDeadline: false });
      } finally {
        Date.now = realNow;
        net.restore();
      }
    });
  });

  test('JSON is written through a temp file; stale pages are pruned only after the new meta exists', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ft-atomic-'));
    try {
      setApiRoot(pathToFileURL(`${root}/`));
      const file = pathToFileURL(`${root}/funds/FDN/meta.json`);
      await writeFileAtomic(file, '{"a":1}\n');
      expect(readFileSync(file, 'utf8')).toBe('{"a":1}\n');
      expect(readdirSync(`${root}/funds/FDN`)).toEqual(['meta.json']);
      mkdirSync(`${root}/funds/FDN/holdings`, { recursive: true });
      for (const name of ['001.json', '002.json', '003.json']) writeFileSync(`${root}/funds/FDN/holdings/${name}`, '{}');
      await pruneStalePages('FDN', 'holdings', ['holdings/001.json']);
      expect(readdirSync(`${root}/funds/FDN/holdings`)).toEqual(['001.json']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('pages are deterministic and run timestamps are ignored when comparing published JSON', () => {
    expect(buildPages([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(buildPages([], 2)).toEqual([]);
    expect(() => buildPages([1], 0)).toThrow('positive integer');
    expect([...pageBasenames(['holdings/001.json', 'holdings/002.json'])]).toEqual(['001.json', '002.json']);
    expect(withoutRunTimestamps({ b: 1, generatedAt: 'x', a: [{ savedAt: 'y', c: 2 }] })).toEqual({ b: 1, a: [{ c: 2 }] });
    expect(samePublishedContent(JSON.stringify({ generatedAt: 'x', funds: [{ t: 1, savedAt: 'a' }] }), { generatedAt: 'z', funds: [{ t: 1, savedAt: 'b' }] })).toBe(true);
    expect(samePublishedContent(JSON.stringify({ generatedAt: 'x', funds: [{ t: 1 }] }), { generatedAt: 'x', funds: [{ t: 2 }] })).toBe(false);
    expect(splitRowCells('<td>A<td>B</td><th>C')).toEqual(['A', 'B', 'C']);
  });

});

describe('network', () => {
  test('each worker lane paces its own requests; a third caller waits a full sleep slot', async () => {
    const starts: number[] = [];
    globalThis.fetch = (async () => { starts.push(Date.now()); return new Response('ok'); }) as unknown as typeof fetch;
    configureRequestLanes(2, 1);
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 3 }, (_, i) => fetchWithRetry(`https://example.test/s${i}`, `s${i}`, {}, 0)));
    const offsets = starts.map((value) => value - t0).sort((a, b) => a - b);
    expect(offsets[2] - offsets[1]).toBeGreaterThan(400);
    expect(offsets[2]).toBeGreaterThanOrEqual(900);
  });

  test('only transient statuses are retried and retries are bounded', async () => {
    let calls = 0;
    const statuses: number[] = [];
    globalThis.fetch = (async () => { calls += 1; return new Response('x', { status: statuses.shift() ?? 200 }); }) as unknown as typeof fetch;
    statuses.push(404, 200);
    await expect(fetchWithRetry('https://example.test/a', 'a', {}, 2)).rejects.toThrow('HTTP 404');
    expect(calls).toBe(1);
    calls = 0;
    statuses.splice(0, statuses.length, 503, 503, 503, 503);
    await expect(fetchWithRetry('https://example.test/b', 'b', {}, 1)).rejects.toThrow();
    expect(calls).toBe(2); // one retry, then give up
  });

  test('timeout covers stalled headers and stalled bodies, and both are retried', async () => {
    let calls = 0;
    const stalled = (signal: AbortSignal | undefined): Promise<never> => new Promise((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason)));
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      calls += 1;
      if (calls === 1) return stalled(init?.signal ?? undefined); // headers never arrive
      if (calls === 2) {
        const body = new ReadableStream({ start(controller) { init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason)); } });
        return new Response(body); // headers arrive, body never does
      }
      return new Response('done');
    }) as unknown as typeof fetch;
    configureRequestLanes(1, 0);
    configureRequestTimeout(60);
    const response = await fetchWithRetry('https://example.test/slow', 'slow', {}, 3);
    expect(await response.text()).toBe('done');
    expect(calls).toBe(3);
    calls = 0;
    await expect(fetchWithRetry('https://example.test/slow', 'slow', {}, 0)).rejects.toThrow('network error');
  });

  test('CONCURRENCY decides how many funds are in flight (peak 1 at 1, peak 2 at 2)', async () => {
    await withFeed(async () => {
      const net = installMockNetwork({ delayMs: 15 });
      try {
        await main({ ...baseEnv, CONCURRENCY: '1' });
        expect(net.stats.peak).toBe(1);
        net.stats.peak = 0;
        await main({ ...baseEnv, CONCURRENCY: '2' });
        expect(net.stats.peak).toBe(2);
      } finally {
        net.restore();
      }
    });
  });

  test('HISTORY_RANGE shrinks the Yahoo request through explicit period1/period2', () => {
    const now = Date.UTC(2026, 9, 2);
    const period2 = Math.floor(now / 1000);
    const query = (range: string): URLSearchParams => new URL(chartUrl('FDN', { ...readConfig({}), historyRange: range }, now)).searchParams;
    expect(query('max').get('period1')).toBe('0');
    expect(query('max').get('range')).toBeNull();
    expect(query('5y').get('period2')).toBe(String(period2));
    expect(Number(query('5y').get('period1'))).toBe(Math.floor(period2 - 5 * 365.25 * 86_400));
    expect(query('5y').get('range')).toBeNull();
    expect(historyStartDate('2y', '2010-01-01', '2026-09-25')).toBe('2024-09-25');
  });

  test('system CA: certificate errors are detected and only they restart the script', async () => {
    expect(isCertError({ code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' })).toBe(true);
    expect(isCertError(new Error('unable to get local issuer certificate'))).toBe(true);
    expect(isCertError(new Error('fetch failed', { cause: new Error('unable to get local issuer certificate') }))).toBe(true);
    expect(isCertError({ code: 'ECONNRESET' })).toBe(false);
    expect(isCertError(new Error('HTTP 403 Forbidden'))).toBe(false);
    const original = globalThis.fetch;
    let reexecs = 0;
    const reexec = (() => { reexecs++; return new Response('restarted') as never; }) as () => never;
    try {
      installSystemCa('false', reexec, false);
      expect(globalThis.fetch).toBe(original);
      installSystemCa('auto', reexec, true);
      expect(globalThis.fetch).toBe(original);
      installSystemCa('true', reexec, false);
      expect(reexecs).toBe(1);

      reexecs = 0;
      globalThis.fetch = (async () => new Response('ok')) as unknown as typeof fetch;
      const ok = globalThis.fetch;
      installSystemCa('auto', reexec, false);
      expect(globalThis.fetch).not.toBe(ok);
      expect(await (await fetch('https://example.test/')).text()).toBe('ok');
      expect(reexecs).toBe(0);

      globalThis.fetch = (async () => { throw Object.assign(new Error('fetch failed'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' }); }) as unknown as typeof fetch;
      installSystemCa('auto', reexec, false);
      await fetch('https://example.test/');
      expect(reexecs).toBe(1);

      globalThis.fetch = (async () => { throw Object.assign(new Error('socket closed'), { code: 'ECONNRESET' }); }) as unknown as typeof fetch;
      installSystemCa('auto', reexec, false);
      await expect(fetch('https://example.test/')).rejects.toThrow('socket closed');
      expect(reexecs).toBe(1);
    } finally {
      globalThis.fetch = original;
    }
  });

});
