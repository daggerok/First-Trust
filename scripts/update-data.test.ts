/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { deflateRawSync } from 'node:zlib';
import {
  buildPages, createRequestGate, fundPasses, historySheetRows, historyStartDate, formatFrequencyPlaceholder,
  indexEntryFromMeta, mergeDistributionRows, metricsFromReturns, outputContentKey, pageBasenames, parseAtomFilings,
  parseAumRange, parseCatalogHtml, parseDistributionHtml, parseFundTickerRefs, parseHiddenInputs, parseHoldingsHtml,
  parseNportHoldings, parsePriceHistoryRows, parseRange, parseSummaryHtml, parseYahooChart, readConfig, readXlsxRows,
  summarizeDistributions, summaryValue,
} from './update-data';

// Fixtures below are trimmed verbatim fragments of the official ftportfolios.com pages (captured 2026-09-28).
const catalogHtml = `
<span id="ContentPlaceHolder1_etfsearch_ctl00_lblETFSectionTitle" style="color:White;font-size:10pt;">Alternative Funds</span></B></TD></TR></TABLE>
<table><!-- <tr><td><a href='/Retail/Etf/EtfSummary.aspx?Ticker=JUNK'>template</a></td></tr> -->
<tr style='background-color: WhiteSmoke;'> <td> <a href='/Retail/Etf/EtfSummary.aspx?Ticker=FTHI'>First Trust BuyWrite Income ETF</a> </td> <td align="center"> FTHI </td> <td align="center"> 01/06/14 </td> <td align="right"> $23.72 </td> <td align="right"> 0.66% </td> <td align="right"> ------- </td> <td align="right"> 8.86% </td> <td align="right"> 08/31/26 </td> <td align="center"> <a target='_blank' href='/Common/ContentFileLoader.aspx?ContentGUID=x'><img alt='Fact Sheet'></a> </td> </tr>
</table>
<span id="ContentPlaceHolder1_etfsearch_ctl05_lblETFSectionTitle" style="color:White;font-size:10pt;">Thematic Funds</span></B></TD></TR></TABLE>
<table>
<tr> <td> <a href='/Retail/Etf/EtfSummary.aspx?Ticker=FDN'>First Trust Dow Jones Internet Index Fund</a> </td> <td align="center"> FDN </td> <td align="center"> 06/19/06 </td> <td align="right"> $291.54 </td> <td align="right"> ------- </td> <td align="right"> ------- </td> <td align="right"> ------- </td> <td align="right"> 08/31/26 </td> </tr>
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
  test('reads the official ETF list sections, ignores commented template rows and keeps list yields', () => {
    const funds = parseCatalogHtml(catalogHtml);
    expect(funds.map(fund => fund.ticker)).toEqual(['FDN', 'FTHI']);
    expect(funds[1]).toMatchObject({ name: 'First Trust BuyWrite Income ETF', category: 'Alternative', navValue: 23.72, secYield: 0.66, dividendYield: 8.86, unsubsidizedSecYield: null, inceptionListed: '2014-01-06', yieldAsOf: '2026-08-31' });
    expect(funds[0]).toMatchObject({ category: 'Thematic', dividendYield: null, secYield: null, aumValue: null, terValue: null });
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

  test('parses Yahoo fallback history and rounds prices to cents', () => {
    const days = parseYahooChart({ chart: { result: [{ timestamp: [1758758400, 1758672000], indicators: { quote: [{ close: [23.745, 23.7] }], adjclose: [{ adjclose: [23.7449, 23.69] }] }, events: { dividends: { 1758672000: { amount: 0.179 } } } }] } });
    expect(days).toEqual([
      { date: '2025-09-24', close: 23.7, adjClose: 23.69, dividend: 0.179 },
      { date: '2025-09-25', close: 23.75, adjClose: 23.74, dividend: null },
    ]);
  });

  test('maps SEC fund symbols and N-PORT-P fallback positions without inventing exchange tickers', () => {
    const refs = parseFundTickerRefs({ fields: ['cik', 'seriesId', 'classId', 'symbol'], data: [[1329377, 'S000012345', 'C000033333', 'FDN']] });
    expect(refs.get('FDN')).toEqual({ cik: '0001329377', seriesId: 'S000012345' });
    expect(parseAtomFilings('<entry><filing-type>NPORT-P</filing-type><accession-number>0001445546-26-001234</accession-number><filing-href>https://www.sec.gov/Archives/edgar/data/1329377/000144554626001234/</filing-href></entry>')).toEqual([{ cik: '1329377', accession: '0001445546-26-001234' }]);
    expect(parseNportHoldings('<invstOrSec><name>Meta Platforms Inc</name><cusip>30303M102</cusip><balance>802106</balance><valUSD>602910995.96</valUSD><pctVal>11.36</pctVal><assetCat>EC</assetCat></invstOrSec>')).toEqual([
      { Name: 'Meta Platforms Inc', Ticker: '-', Identifier: '30303M102', Weight: '11.36', 'Market Value': '602910995.96', 'Shares Held': '802106', 'Asset Category': 'EC' },
    ]);
  });

  test('builds index entries in the shared sibling schema', () => {
    const fund = { ticker: 'FTHI', name: 'First Trust BuyWrite Income ETF', category: 'Alternative', navValue: 23.72, aumValue: null, terValue: null, dividendYield: 8.86, secYield: 0.66 };
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
  test('supports inclusive ranges, K/M/B/T AUM bounds and presets', () => {
    expect(parseRange('0.2:2').min).toBe(0.2);
    expect(parseAumRange('10M:2B')).toMatchObject({ min: 10000000, max: 2000000000 });
    expect(parseAumRange('small')).toMatchObject({ min: 300000000, max: 2000000000 });
    expect(() => parseRange('1')).toThrow('colon required');
    expect(() => parseRange('5:1')).toThrow('exceeds');
  });

  test('reads conservative defaults and applies data filters to published values', () => {
    const config = readConfig({ TICKERS: 'fdn, ftsm fjan', TER: ':0.6', PERFORMANCE_1Y: '10:' });
    expect(config).toMatchObject({ requestSleep: 1, concurrency: 2, maxRetries: 2, holdingsPageSize: 250, historyPageSize: 1000, historyRange: 'max', edgarFallback: true, skipYahoo: false });
    expect([...config.tickers]).toEqual(['FDN', 'FTSM', 'FJAN']);
    const base = { ticker: 'X', name: 'X', category: 'Income', navValue: 1, aumValue: 1e9, dividendYield: null, secYield: null };
    expect(fundPasses({ ...base, terValue: 0.5, returns: { monthEnd: { yr1: 12 } } }, config)).toBe(true);
    expect(fundPasses({ ...base, terValue: 0.75, returns: { monthEnd: { yr1: 12 } } }, config)).toBe(false);
    expect(fundPasses({ ...base, terValue: 0.5, returns: { monthEnd: { yr1: 5 } } }, config)).toBe(false);
    expect(fundPasses({ ...base, terValue: null, returns: { monthEnd: { yr1: 12 } } }, config)).toBe(false);
  });

  test('paces each worker lane independently', async () => {
    let clock = 0;
    const waits: number[] = [];
    const pace = createRequestGate(2, 1000, () => clock, async ms => { waits.push(ms); clock += ms; });
    expect(await pace()).toBe(0);
    expect(await pace()).toBe(1);
    expect(waits).toEqual([]);
    await pace();
    expect(waits).toEqual([1000]);
  });

  test('paginates deterministic row sets and ignores timestamps when comparing published JSON', () => {
    expect(buildPages([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(buildPages([], 2)).toEqual([]);
    expect(() => buildPages([1], 0)).toThrow('positive integer');
    expect([...pageBasenames(['holdings/001.json', 'holdings/002.json'])]).toEqual(['001.json', '002.json']);
    expect(outputContentKey({ b: 1, generatedAt: 'x', a: { generatedAt: 'y', c: 2 } })).toBe(outputContentKey({ a: { c: 2 }, b: 1, generatedAt: 'z' }));
  });

  test('uses the requested None presentation placeholder and preserves Unknown', () => {
    for (const missing of [null, undefined, '', '  ', '-', '—']) expect(formatFrequencyPlaceholder(missing)).toBe('00 - None');
    expect(formatFrequencyPlaceholder('none')).toBe('00 - None');
    expect(formatFrequencyPlaceholder('unknown')).toBe('00 - Unknown');
    expect(formatFrequencyPlaceholder('Monthly')).toBe('01 - Monthly');
    expect(formatFrequencyPlaceholder('Semi-annually')).toBe('06 - Semi-annually');
  });
});
