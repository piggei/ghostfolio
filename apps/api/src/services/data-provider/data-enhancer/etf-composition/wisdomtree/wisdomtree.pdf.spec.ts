import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { parseWisdomtreePdf } from './wisdomtree.parser';

jest.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: jest.fn()
}));

describe('WisdomTree allocation page discovery', () => {
  const isin = 'IE00BDVPNG13';
  const items = JSON.parse(
    readFileSync(join(__dirname, '__fixtures__', isin + '.json'), 'utf8')
  );

  it('finds the allocation page independently of its page number', async () => {
    const destroy = jest.fn();
    (getDocument as jest.Mock).mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getPage: async (number: number) => ({
          getTextContent: async () => ({ items: number === 2 ? items : [] })
        })
      }),
      destroy
    });
    expect((await parseWisdomtreePdf(new Uint8Array(), isin)).isin).toBe(isin);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('rejects multiple allocation pages and releases PDF resources', async () => {
    const destroy = jest.fn();
    (getDocument as jest.Mock).mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getPage: async () => ({ getTextContent: async () => ({ items }) })
      }),
      destroy
    });
    await expect(parseWisdomtreePdf(new Uint8Array(), isin)).rejects.toThrow(
      'ambiguous'
    );
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
