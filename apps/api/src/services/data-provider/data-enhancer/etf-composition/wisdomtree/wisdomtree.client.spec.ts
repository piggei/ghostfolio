import { fetchWisdomtreeFactsheet } from './wisdomtree.client';

const PDF = new Uint8Array(Buffer.from('%PDF-1.7\nexample'));

describe('WisdomTree factsheet client', () => {
  it('downloads a PDF', async () => {
    const fetch = jest.fn().mockResolvedValue(
      new Response(PDF, {
        headers: { 'content-type': 'application/pdf' }
      })
    );
    const bytes = await fetchWisdomtreeFactsheet({
      isin: 'IE00BZ56SW52',
      fetchService: { fetch } as any,
      requestTimeout: 30000
    });
    expect(bytes).toEqual(PDF);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects an HTTP failure', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValue(new Response(null, { status: 403 }));
    await expect(
      fetchWisdomtreeFactsheet({
        isin: 'IE00BZ56SW52',
        fetchService: { fetch } as any,
        requestTimeout: 30000
      })
    ).rejects.toThrow('HTTP status 403');
  });

  it('rejects HTML disguised as a PDF', async () => {
    const fetch = jest.fn().mockResolvedValue(
      new Response('<html>blocked</html>', {
        headers: { 'content-type': 'application/pdf' }
      })
    );
    await expect(
      fetchWisdomtreeFactsheet({
        isin: 'IE00BZ56SW52',
        fetchService: { fetch } as any,
        requestTimeout: 30000
      })
    ).rejects.toThrow('PDF signature');
  });
});
