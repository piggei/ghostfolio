import { MODULE_METADATA } from '@nestjs/common/constants';

import { DailyNavOrchestratorService } from './daily-nav-orchestrator.service';
import { PortfolioModule } from './portfolio.module';

// These packages are ECMAScript modules, which Jest cannot load.
jest.mock('@openrouter/ai-sdk-provider', () => {
  return {};
});
jest.mock('ai', () => {
  return {};
});

describe('PortfolioModule', () => {
  it('registers DailyNavOrchestratorService as a provider', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      PortfolioModule
    );

    expect(providers).toContain(DailyNavOrchestratorService);
  });
});
