import { execFileSync } from 'node:child_process';

import { IsharesDataEnhancerService } from './ishares/ishares.service';
import { VanguardDataEnhancerService } from './vanguard/vanguard.service';
import { WisdomtreeDataEnhancerService } from './wisdomtree/wisdomtree.service';
import { XtrackersDataEnhancerService } from './xtrackers/xtrackers.service';

jest.mock('@ghostfolio/api/services/fetch/fetch.service', () => ({
  FetchService: jest.fn()
}));

// Jest transpiles dynamic imports to CommonJS; extract with native ESM in a
// child process, then run the same production allocation parser in this suite.
jest.mock('./wisdomtree/wisdomtree.parser', () => {
  const actual = jest.requireActual('./wisdomtree/wisdomtree.parser');
  return {
    ...actual,
    parseWisdomtreePdf: async (data: Uint8Array, isin: string) => {
      const source =
        'import {getDocument} from "pdfjs-dist/legacy/build/pdf.mjs"; import {readFileSync} from "node:fs"; const task=getDocument({data:new Uint8Array(readFileSync(0)),useSystemFonts:true,disableFontFace:true,verbosity:0}); try { const doc=await task.promise; const page=await doc.getPage(3); console.log(JSON.stringify((await page.getTextContent()).items)); } finally { await task.destroy(); }';
      const output = execFileSync(
        process.execPath,
        ['--input-type=module', '-e', source],
        { input: Buffer.from(data), maxBuffer: 10000000 }
      );
      return actual.parseWisdomtreeFactsheet(
        JSON.parse(output.toString()),
        isin
      );
    }
  };
});

// Explicit opt-in; ordinary CI excludes *.live.spec.ts.
const cases = [
  [IsharesDataEnhancerService, 'iShares ETF', 'IE00B4L5Y983'],
  [IsharesDataEnhancerService, 'iShares ETF', 'IE00B5BMR087'],
  [IsharesDataEnhancerService, 'iShares ETF', 'IE00BKM4GZ66'],
  [VanguardDataEnhancerService, 'Vanguard ETF', 'IE00BK5BQT80'],
  [VanguardDataEnhancerService, 'Vanguard ETF', 'IE00B810Q511'],
  [VanguardDataEnhancerService, 'Vanguard ETF', 'IE00B3XXRP09'],
  [XtrackersDataEnhancerService, 'Xtrackers ETF', 'IE00BTJRMP35'],
  [XtrackersDataEnhancerService, 'Xtrackers ETF', 'IE00BGV5VN51'],
  [XtrackersDataEnhancerService, 'Xtrackers ETF', 'IE00BJ0KDQ92'],
  [WisdomtreeDataEnhancerService, 'WisdomTree ETF', 'IE00BZ56SW52'],
  [WisdomtreeDataEnhancerService, 'WisdomTree ETF', 'IE00BDVPNG13'],
  [WisdomtreeDataEnhancerService, 'WisdomTree ETF', 'IE00BJGWQN72']
] as const;

(process.env.LIVE_ETF === '1' ? describe : describe.skip)(
  'official issuer qualification',
  () => {
    it.each(cases)(
      '%s %s %s',
      async (Service, name, isin) => {
        const requests: { url: string; status: number }[] = [];
        const fetchService = {
          fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
            const result = await fetch(url, init);
            requests.push({ url: String(url), status: result.status });
            return result;
          }
        };
        const service = new Service(
          { get: () => 15000 } as any,
          fetchService as any
        );
        const result = await service.enhance({
          response: {
            name,
            isin,
            assetClass: 'EQUITY',
            assetSubClass: 'ETF',
            dataSource: 'YAHOO'
          },
          symbol: 'UNCONFIGURED.MI',
          requestTimeout: 15000
        });
        console.log(
          JSON.stringify({
            issuer: service.getName(),
            isin,
            countries: result.countries,
            sectors: result.sectors,
            requests
          })
        );
        expect(
          Array.isArray(result.countries) || Array.isArray(result.sectors)
        ).toBe(true);
      },
      120000
    );
  }
);
