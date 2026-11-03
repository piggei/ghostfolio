import { PortfolioSnapshot } from '@ghostfolio/common/models';

import { PortfolioSnapshotCalculationContext } from './snapshot-calculation-context.interface';

export interface PortfolioSnapshotValue {
  calculationContext?: PortfolioSnapshotCalculationContext;
  expiration: number;
  portfolioSnapshot: PortfolioSnapshot;
}
