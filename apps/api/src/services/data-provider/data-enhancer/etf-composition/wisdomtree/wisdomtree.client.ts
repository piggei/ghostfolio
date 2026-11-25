import { FetchService } from '@ghostfolio/api/services/fetch/fetch.service';

export const WISDOMTREE_FACTSHEET_URL =
  'https://dataspanapi.wisdomtree.com/pdr/documents/FACTSHEET/UCITS/EU/EN-GB/IE00BZ56SW52/';

export async function fetchWisdomtreeFactsheet({
  fetchService,
  requestTimeout
}: {
  fetchService: Pick<FetchService, 'fetch'>;
  requestTimeout: number;
}): Promise<Uint8Array> {
  if (!Number.isFinite(requestTimeout) || requestTimeout <= 0) {
    throw new Error('Invalid WisdomTree timeout');
  }

  const response = await fetchService.fetch(WISDOMTREE_FACTSHEET_URL, {
    signal: AbortSignal.timeout(requestTimeout)
  });
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
