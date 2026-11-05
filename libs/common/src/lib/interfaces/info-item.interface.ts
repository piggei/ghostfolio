import type { SymbolProfile } from '@ghostfolio/prisma/browser';

import type { GhostfolioNgBuildInfo } from '../ghostfolio-ng-build-info';
import { Statistics } from './statistics.interface';
import { SubscriptionOffer } from './subscription-offer.interface';

export interface InfoItem {
  isGhostfolioNg: boolean;
  ghostfolioNgBuildInfo?: GhostfolioNgBuildInfo;
  baseCurrency: string;
  benchmarks: Partial<SymbolProfile>[];
  countriesOfSubscribers?: string[];
  currencies: string[];
  demoAuthToken: string;
  fearAndGreedStocksMarketPrice?: number;
  globalPermissions: string[];
  isDataGatheringEnabled?: string;
  isReadOnlyMode?: boolean;
  statistics: Statistics;
  subscriptionOffer?: SubscriptionOffer;
  subscriptionOfferMax?: SubscriptionOffer;
}
