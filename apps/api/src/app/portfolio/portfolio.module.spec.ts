import { Test, TestingModule } from '@nestjs/testing';

import { DailyNavOrchestratorService } from './daily-nav-orchestrator.service';
import { PortfolioModule } from './portfolio.module';

describe('PortfolioModule dependency injection', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PortfolioModule]
    }).compile();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('resolves DailyNavOrchestratorService from PortfolioModule', () => {
    const service = moduleRef.get(DailyNavOrchestratorService, {
      strict: false
    });

    expect(service).toBeInstanceOf(DailyNavOrchestratorService);
  });
});
