/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import {
  applyCatalogPerformance, buildPages, catalogOnlyEntry, configureRequestLanes, emptyReturns, fetchWithRetry, firstTrustIsoDate,
  formatFrequencyPlaceholder, fundPasses, historySheetRows, historyStartDate, indexEntryFromMeta, mapReturnRow,
  mergeDistributionRows, metricsFromReturns, normalizeHistoryRange, pageBasenames, parseAumRange, parseCatalogHtml, parseChart,
  parseDistributionHtml, parseEdgarAtomFilings, parseFundTickerMap, parseHiddenInputs, parseHoldingsHtml, parseNport,
  parsePerformanceNavHtml, parsePriceHistoryRows, parseRange, parseSummaryHtml, readConfig, readXlsxRows, returnForFilter,
  returnSlot, samePublishedContent, splitRowCells, summarizeDistributions, summaryValue, toNumber, withoutRunTimestamps,
  type Fund,
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

describe('First Trust official source parsers', () => {
  test('reads the official ETF list sections by header label, ignores commented template rows and keeps list yields', () => {
    const funds = parseCatalogHtml(catalogHtml);
    expect(funds.map(fund => fund.ticker)).toEqual(['FDN', 'FTHI']);
    expect(funds[1]).toMatchObject({ name: 'First Trust BuyWrite Income ETF', category: 'Alternative', navValue: 23.72, secYield: 0.66, dividendYield: 8.86, unsubsidizedSecYield: null, inceptionListed: '2014-01-06', yieldAsOf: '2026-08-31' });
    expect(funds[0]).toMatchObject({ category: 'Thematic', dividendYield: null, secYield: null, aumValue: null, terValue: null, returns: null });
    expect(firstTrustIsoDate('08/31/26')).toBe('2026-08-31');
    expect(firstTrustIsoDate('12/21/99')).toBe('1999-12-21');
    expect(firstTrustIsoDate('9/25/2026')).toBe('2026-09-25');
  });

  test('enriches every catalog fund with gross/net TER and month-end NAV returns from the NAV performance view', () => {
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
  });

  test('maps every return tenor by header label, whatever the column order', () => {
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

  test('parses summary name/value pairs, as-of dates, gross TER date and month/quarter-end NAV returns', () => {
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

  test('derives cumulative total returns from official annualized return tenors', () => {
    const metrics = metricsFromReturns({ asOfDate: null, mo3: 1, ytd: 2, yr1: 10, yr3: 10, yr5: 10, yr10: null, sinceInception: 8 });
    expect(metrics).toMatchObject({ tr1y: 10, tr3y: 33.1, tr5y: 61.05, tr10y: null, cagr3y: 10, siAnn: 8 });
  });

  test('maps equity, international, cash, options and bond holdings to the shared Watchlist columns', () => {
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

  test('keeps official distribution columns, merges years incrementally and infers cadence', () => {
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

  test('reads ASP.NET hidden form fields and the official price-history Excel export', () => {
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

  test('parses the Yahoo fallback chart with the shared JPMorgan helper and requests explicit daily periods', async () => {
    const chart = parseChart({ chart: { result: [{ meta: { longName: 'FT', regularMarketPrice: 23.7 }, timestamp: [1758672000, 1758758400], indicators: { quote: [{ close: [23.7000004, 23.745], volume: [100, null] }], adjclose: [{ adjclose: [23.6912, 23.7449] }] }, events: { dividends: { 1758672000: { date: 1758672000, amount: 0.179 } } } }] } });
    expect(chart.days).toEqual([
      { date: '2025-09-24', close: 23.7, adjClose: 23.69, volume: 100 },
      { date: '2025-09-25', close: 23.745, adjClose: 23.74, volume: 0 },
    ]);
    expect(chart.dividends).toEqual([{ epoch: 1758672000, amount: 0.179 }]);
    const source = await readFile(new URL('./update-data.ts', import.meta.url), 'utf8');
    expect(source).toContain('period1=${period1}&period2=${period2}&interval=1d&events=div%7Csplit');
    expect(source).not.toMatch(/[?&]range=|\{ range: /);
  });

  test('maps SEC fund symbols and N-PORT-P fallback positions without inventing exchange tickers', () => {
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

  test('builds index entries in the shared sibling schema', () => {
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
  });
});

describe('configuration, pacing, paging and display normalization', () => {
  test('supports strict min:max ranges, K/M/B/T AUM bounds and presets', () => {
    expect(parseRange('0.2:2', 'TER')).toEqual({ min: 0.2, max: 2 });
    expect(parseRange(':', 'TER')).toBeUndefined();
    expect(parseRange('', 'TER')).toBeUndefined();
    expect(parseAumRange('10M:2B')).toMatchObject({ min: 10000000, max: 2000000000 });
    expect(parseAumRange('small')).toMatchObject({ min: 300000000, max: 2000000000 });
    expect(() => parseRange('1', 'TER')).toThrow('a colon is required');
    expect(() => parseRange('5:1', 'TER')).toThrow('must not exceed');
    expect(() => parseRange('a:1', 'TER')).toThrow('is not a number');
    expect(['max', '10y', '6mo', 'MAX', 'forever', ''].map(normalizeHistoryRange)).toEqual(['max', '10y', '6mo', 'max', 'max', 'max']);
  });

  test('reads conservative defaults and applies data filters to published values', () => {
    const config = readConfig({ TICKERS: 'fdn, ftsm;fjan', TER: ':0.6', FIRSTTRUST_PERFORMANCE_1Y: '10:', TOTAL_RETURN_3Y: '30:' });
    expect(config).toMatchObject({ requestSleep: 1, concurrency: 2, maxRetries: 2, maxFetches: 0, holdingsPageSize: 250, historyPageSize: 1000, historyRange: 'max', edgarFallback: true, skipYahoo: false, secUa: '' });
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

  test('paces each worker lane independently and retries only transient HTTP statuses', async () => {
    const originalFetch = globalThis.fetch;
    const starts: number[] = [];
    const statuses = [200, 404];
    globalThis.fetch = (async () => { starts.push(Date.now()); return new Response('ok', { status: statuses.shift() ?? 200 }); }) as unknown as typeof fetch;
    try {
      configureRequestLanes(2, 0.3);
      const t0 = Date.now();
      await Promise.all([fetchWithRetry('https://example.test/a', 'a', {}, 0), fetchWithRetry('https://example.test/b', 'b', {}, 0).catch(() => null)]);
      expect(starts.length).toBe(2);
      expect(starts[1] - t0).toBeLessThan(150);
      statuses.splice(0, statuses.length, 200);
      await fetchWithRetry('https://example.test/c', 'c', {}, 0);
      expect(starts[2] - t0).toBeGreaterThanOrEqual(280);
      configureRequestLanes(1, 0);
      statuses.splice(0, statuses.length, 503, 200);
      expect((await fetchWithRetry('https://example.test/d', 'd', {}, 1)).status).toBe(200);
      statuses.splice(0, statuses.length, 404, 200);
      await expect(fetchWithRetry('https://example.test/e', 'e', {}, 2)).rejects.toThrow('HTTP 404');
      expect(statuses).toEqual([200]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('paginates deterministic row sets and ignores run timestamps recursively when comparing published JSON', () => {
    expect(buildPages([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(buildPages([], 2)).toEqual([]);
    expect(() => buildPages([1], 0)).toThrow('positive integer');
    expect([...pageBasenames(['holdings/001.json', 'holdings/002.json'])]).toEqual(['001.json', '002.json']);
    expect(withoutRunTimestamps({ b: 1, generatedAt: 'x', a: [{ savedAt: 'y', c: 2 }] })).toEqual({ b: 1, a: [{ c: 2 }] });
    expect(samePublishedContent(JSON.stringify({ generatedAt: 'x', funds: [{ t: 1, savedAt: 'a' }] }), { generatedAt: 'z', funds: [{ t: 1, savedAt: 'b' }] })).toBe(true);
    expect(samePublishedContent(JSON.stringify({ generatedAt: 'x', funds: [{ t: 1 }] }), { generatedAt: 'x', funds: [{ t: 2 }] })).toBe(false);
    expect(splitRowCells('<td>A<td>B</td><th>C')).toEqual(['A', 'B', 'C']);
  });

  test('uses the requested None presentation placeholder and preserves Unknown', () => {
    for (const missing of [null, undefined, '', '  ', '-', '—']) expect(formatFrequencyPlaceholder(missing)).toBe('00 - None');
    expect(formatFrequencyPlaceholder('none')).toBe('00 - None');
    expect(formatFrequencyPlaceholder('unknown')).toBe('00 - Unknown');
    expect(formatFrequencyPlaceholder('Monthly')).toBe('01 - Monthly');
    expect(formatFrequencyPlaceholder('Semi-annually')).toBe('06 - Semi-annually');
  });
});

const appSource = await readFile(new URL('../app.tsx', import.meta.url), 'utf8');
function extractAppFunction(name: string): (...args: any[]) => any {
  const text = appSource;
  const match = new RegExp(`\\nfunction ${name}\\(([^)]*)\\)[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(text);
  if (!match) throw new Error(`${name} was not found in app.tsx`);
  const parameters = match[1].split(',').map(part => part.split(':')[0].split('=')[0].trim()).filter(Boolean).join(', ');
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(`function ${name}(${parameters}) {${match[2]}\n}`);
  return new Function(`${js}; return ${name};`)();
}

describe('UI parity regression guards', () => {
  test('the copied app formats missing/dash frequencies as None and preserves explicit Unknown', () => {
    const format = extractAppFunction('formatDividendFrequency');
    for (const value of [null, undefined, '', '  ', '-', '‐', '‑', '‒', '–', '—', ' — ']) expect(format(value)).toBe('00 - None');
    expect(format('None')).toBe('00 - None');
    expect(format('Unknown')).toBe('00 - Unknown');
    expect(format('Monthly')).toBe('01 - Monthly');
  });

  test('header summary moves the rich detail nodes and shows alphabetized selected tickers, including all-selected', async () => {
    const text = await readFile(new URL('../app.tsx', import.meta.url), 'utf8');
    const match = /^([ \t]*)function renderHeaderSummary\(/m.exec(text);
    expect(match).not.toBeNull();
    const tail = text.slice(match!.index);
    const end = new RegExp('^' + match![1] + '}', 'm').exec(tail);
    expect(end).not.toBeNull();
    const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(tail.slice(0, end!.index + end![0].length));
    const node = (value = ''): any => ({ textContent: value, childNodes: [], dataset: {}, listeners: {}, replaceChildren(...items: any[]) { this.childNodes = items; }, append(...items: any[]) { this.childNodes.push(...items); }, addEventListener(type: string, listener: any) { this.listeners[type] = listener; } });
    const panel = node(), subtitle = node(), details = node('rich source links');
    subtitle.append(details);
    const document = { getElementById: () => panel, createTextNode: node, createElement: () => node() };
    const render = new Function('document', js + '; return renderHeaderSummary;')(document);
    render(subtitle, new Set(['ZZZ', 'AAA']), 'AAA', () => {});
    expect(subtitle.childNodes.map((item: any) => item.textContent).join('')).toBe('2 selected: AAA, ZZZ');
    expect(panel.childNodes[0]).toBe(details);
    render(subtitle, new Set(['CCC', 'AAA', 'BBB']), 'BBB', () => {});
    expect(subtitle.childNodes.map((item: any) => item.textContent).join('')).toBe('3 selected: AAA, BBB, CCC');
    render(subtitle, new Set(), null, () => {});
    expect(subtitle.childNodes).toEqual([]);
  });

  test('hidden source panel retains mouse, keyboard, touch, Escape and viewport-safe behaviors', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).toContain('id="app-summary" role="region" aria-label="ETF catalog information" hidden');
    expect(html).toContain("trigger.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') show(); })");
    expect(html).toContain("trigger.addEventListener('focus', show)");
    expect(html).toContain("event.key !== 'Escape'");
    expect(html).toContain('innerWidth - panel.offsetWidth - 16');
    expect(html).toContain('innerHeight - panel.offsetHeight - 16');
    expect(html).toContain("trigger.addEventListener('click'");
    expect(html).toContain('official First Trust ETF list and fund pages (ftportfolios.com)');
    expect(html).toContain('SEC EDGAR N-PORT-P (First Trust ETF trusts — holdings fallback only)');
    expect(html).toContain('Yahoo Finance (market-price history fallback only)');
    expect(html).not.toMatch(/jpmorgan|victoryshares/i);
    expect(appSource).not.toMatch(/jpmorgan|victoryshares/i);
    expect(appSource).toContain("const INDEX_URL = './api/firsttrust/index.json';");
  });
});

describe('README and automation documentation guards', () => {
  test('keeps the pinned sibling README structure and reports the verified published site', async () => {
    const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
    const headings = [...readme.matchAll(/^#{2,3} .+$/gm)].map(match => match[0]);
    expect(headings).toEqual([
      '## Using Bun', '## Updating the static First Trust data', '### Data sources', '### Update controls', '### Examples',
      '## TypeScript', '## Brands table', '## Sibling applications', '## License',
    ]);
    expect(readme).toContain('bunx degit daggerok/First-Trust#main ./12345 && cd $_');
    expect(readme).toContain('bun test scripts/update-data.test.ts');
    expect(readme).toContain('The published application is available at <https://daggerok.github.io/First-Trust/>.');
    expect(readme).not.toContain('deployment has not been verified');
    expect(readme).not.toContain('initial checked-in seed');
    const brandRows = [...readme.matchAll(/^\| \*\*(.+?)\*\* \|/gm)].map(match => match[1]);
    expect(brandRows.indexOf('First Trust')).toBe(brandRows.indexOf('Fidelity') + 1);
    expect(brandRows.indexOf('Franklin Templeton')).toBe(brandRows.indexOf('First Trust') + 1);
    expect(readme).toContain('| First Trust | ftportfolios.com official ETF list');
  });

  test('documents every updater environment variable and exposes a matching manual workflow input', async () => {
    const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
    const workflow = await readFile(new URL('../.github/workflows/update-data.yml', import.meta.url), 'utf8');
    const envVars = [
      'MAX_FETCHES', 'REQUEST_SLEEP', 'CONCURRENCY', 'MAX_RETRIES', 'HOLDINGS_PAGE_SIZE', 'HISTORY_PAGE_SIZE', 'HISTORY_RANGE',
      'TICKERS', 'AUM', 'TER', 'DIVIDEND_YIELD', 'SEC_YIELD', 'PERFORMANCE_YTD', 'PERFORMANCE_1Y', 'PERFORMANCE_3Y',
      'PERFORMANCE_5Y', 'PERFORMANCE_10Y', 'TOTAL_RETURN_YTD', 'TOTAL_RETURN_1Y', 'TOTAL_RETURN_3Y', 'TOTAL_RETURN_5Y',
      'TOTAL_RETURN_10Y', 'EDGAR_FALLBACK', 'SEC_UA', 'SKIP_YAHOO', 'VERBOSE',
    ];
    for (const variable of envVars) expect(readme).toContain(`\`${variable}\``);
    const inputs = [...workflow.matchAll(/^      ([a-z][a-z0-9_]*):$/gm)].map(match => match[1]);
    for (const variable of envVars) {
      expect(inputs).toContain(variable.toLowerCase());
      expect(workflow).toMatch(new RegExp(`^      ${variable}: \\$\\{\\{ inputs\\.${variable.toLowerCase()} \\|\\| `, 'm'));
    }
    expect(workflow).toContain("cron: '0 0 * * 0'");
    expect(workflow).toContain('bun test scripts/update-data.test.ts');
    expect(workflow).not.toContain('bunx tsc');
  });
});
