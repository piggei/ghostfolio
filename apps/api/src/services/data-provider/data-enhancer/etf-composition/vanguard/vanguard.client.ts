import { parseVanguardHoldingsPage, VanguardHolding } from './vanguard.parser';

export const VANGUARD_PAGE_LIMIT = 1500;

export interface VanguardFetchPageParams {
  portId: string;
  limit: number;
  lastItemKey: string | null;
}

export type VanguardFetchPage = (
  params: VanguardFetchPageParams
) => Promise<unknown>;

export async function fetchVanguardHoldings({
  fetchPage,
  portId
}: {
  fetchPage: VanguardFetchPage;
  portId: string;
}): Promise<VanguardHolding[]> {
  if (typeof portId !== 'string' || !portId.trim()) {
    throw new Error('Invalid Vanguard portfolio ID');
  }

  const holdings: VanguardHolding[] = [];
  const cursors = new Set<string>();

  let lastItemKey: string | null = null;
  let expectedTotal: number | undefined;

  do {
    const response = await fetchPage({
      portId,
      limit: VANGUARD_PAGE_LIMIT,
      lastItemKey
    });

    const page = parseVanguardHoldingsPage(response);

    if (expectedTotal === undefined) {
      expectedTotal = page.totalHoldings;

      if (expectedTotal === 0) {
        throw new Error('Empty Vanguard portfolio');
      }
    } else if (page.totalHoldings !== expectedTotal) {
      throw new Error('Vanguard holdings total changed');
    }

    if (page.holdings.length === 0) {
      throw new Error('Empty Vanguard holdings page');
    }

    if (page.holdings.length > VANGUARD_PAGE_LIMIT) {
      throw new Error('Vanguard page exceeds requested limit');
    }

    if (holdings.length + page.holdings.length > expectedTotal) {
      throw new Error('Vanguard holdings exceed declared total');
    }

    holdings.push(...page.holdings);

    if (holdings.length === expectedTotal) {
      return holdings;
    }

    if (!page.lastItemKey) {
      throw new Error('Missing Vanguard pagination cursor');
    }

    if (cursors.has(page.lastItemKey)) {
      throw new Error('Repeated Vanguard pagination cursor');
    }

    cursors.add(page.lastItemKey);
    lastItemKey = page.lastItemKey;
  } while (true);
}
