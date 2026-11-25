import { FetchService } from '@ghostfolio/api/services/fetch/fetch.service';

export const WISDOMTREE_FACTSHEET_URL =
  'https://dataspanapi.wisdomtree.com/pdr/documents/FACTSHEET/UCITS/EU/EN-GB/';

export async function fetchWisdomtreeFactsheet({
  isin,
  fetchService,
  requestTimeout
}: {
  isin: string;
  fetchService: Pick<FetchService, 'fetch'>;
  requestTimeout: number;
}): Promise<Uint8Array> {
  if (!Number.isFinite(requestTimeout) || requestTimeout <= 0) {
    throw new Error('Invalid WisdomTree timeout');
  }

  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin))
    throw new Error('Invalid WisdomTree ISIN');
  const response = await fetchService.fetch(
    WISDOMTREE_FACTSHEET_URL + isin + '/',
    {
      signal: AbortSignal.timeout(requestTimeout)
    }
  );
  if (!response.ok) {
    throw new Error(`WisdomTree HTTP status ${response.status}`);
  }
  if (
    !(response.headers.get('content-type') ?? '')
      .toLowerCase()
      .includes('application/pdf')
  ) {
    throw new Error('Unexpected WisdomTree content type');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (
    bytes.length < 8 ||
    new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-'
  ) {
    throw new Error('Invalid WisdomTree PDF signature');
  }
  return bytes;
}
