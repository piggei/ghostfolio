import { ExchangeRatesByCurrency } from '@ghostfolio/api/services/exchange-rate-data/interfaces/exchange-rate-data.interface';

export interface PortfolioSnapshotCalculationContext {
  currency: string;
  exchangeRatesByCurrency: ExchangeRatesByCurrency;
  version: 1;
}
