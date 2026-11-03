import { ConfigurationService } from './configuration.service';

describe('ConfigurationService', () => {
  const originalAccessTokenSalt = process.env.ACCESS_TOKEN_SALT;
  const originalJwtSecretKey = process.env.JWT_SECRET_KEY;
  const originalGhostfolioNg = process.env.GHOSTFOLIO_NG;

  afterEach(() => {
    if (originalAccessTokenSalt === undefined) {
      delete process.env.ACCESS_TOKEN_SALT;
    } else {
      process.env.ACCESS_TOKEN_SALT = originalAccessTokenSalt;
    }

    if (originalJwtSecretKey === undefined) {
      delete process.env.JWT_SECRET_KEY;
    } else {
      process.env.JWT_SECRET_KEY = originalJwtSecretKey;
    }

    if (originalGhostfolioNg === undefined) {
      delete process.env.GHOSTFOLIO_NG;
    } else {
      process.env.GHOSTFOLIO_NG = originalGhostfolioNg;
    }
  });

  beforeEach(() => {
    process.env.ACCESS_TOKEN_SALT = 'test-access-token-salt';
    process.env.JWT_SECRET_KEY = 'test-jwt-secret-key';
    delete process.env.GHOSTFOLIO_NG;
  });

  it('should disable Ghostfolio NG by default', () => {
    const configurationService = new ConfigurationService();

    expect(configurationService.get('GHOSTFOLIO_NG')).toBe(false);
  });

  it('should enable Ghostfolio NG when explicitly configured', () => {
    process.env.GHOSTFOLIO_NG = 'true';

    const configurationService = new ConfigurationService();

    expect(configurationService.get('GHOSTFOLIO_NG')).toBe(true);
  });
});
