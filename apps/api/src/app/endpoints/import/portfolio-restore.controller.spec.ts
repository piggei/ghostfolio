import { permissions } from '@ghostfolio/common/permissions';

import { ForbiddenException } from '@nestjs/common';

import { PortfolioRestoreController } from './portfolio-restore.controller';

describe('PortfolioRestoreController authorization', () => {
  const input = {
    backup: { accounts: [], activities: [] },
    choices: [],
    digest: 'preview-digest'
  } as never;

  const allPermissions = Object.values(permissions);

  let controller: PortfolioRestoreController;
  let service: { run: jest.Mock };
  let request: {
    user: {
      id: string;
      permissions: string[];
      settings: { settings: { isRestrictedView: boolean } };
    };
    impersonation: { isActive: boolean };
  };

  beforeEach(() => {
    service = { run: jest.fn().mockResolvedValue({ digest: 'result' }) };

    request = {
      user: {
        id: 'portfolio-owner',
        permissions: [...allPermissions],
        settings: { settings: { isRestrictedView: false } }
      },
      impersonation: { isActive: false }
    };

    controller = new PortfolioRestoreController(
      service as never,
      request as never
    );
  });

  it('routes replacement preview and confirmation to REPLACE mode', async () => {
    await controller.replacePreview(input);

    expect(service.run).toHaveBeenLastCalledWith(
      input,
      'portfolio-owner',
      true,
      'REPLACE'
    );

    await controller.replace(input);

    expect(service.run).toHaveBeenLastCalledWith(
      input,
      'portfolio-owner',
      false,
      'REPLACE'
    );

    expect(service.run).toHaveBeenCalledTimes(2);
  });

  it.each([
    permissions.createAccount,
    permissions.createActivity,
    permissions.deleteAccount,
    permissions.deleteActivity
  ])('rejects REPLACE without permission %s', async (missingPermission) => {
    request.user.permissions = allPermissions.filter(
      (permission) => permission !== missingPermission
    );

    expect(() => controller.replacePreview(input)).toThrow(ForbiddenException);
    expect(() => controller.replace(input)).toThrow(ForbiddenException);
    expect(service.run).not.toHaveBeenCalled();
  });

  it('rejects impersonated replacement', () => {
    request.impersonation.isActive = true;

    expect(() => controller.replacePreview(input)).toThrow(ForbiddenException);
    expect(() => controller.replace(input)).toThrow(ForbiddenException);
    expect(service.run).not.toHaveBeenCalled();
  });

  it('rejects replacement from a restricted view', () => {
    request.user.settings.settings.isRestrictedView = true;

    expect(() => controller.replacePreview(input)).toThrow(ForbiddenException);
    expect(() => controller.replace(input)).toThrow(ForbiddenException);
    expect(service.run).not.toHaveBeenCalled();
  });

  it('keeps existing IMPORT routes in IMPORT mode', async () => {
    await controller.preview(input);

    expect(service.run).toHaveBeenLastCalledWith(
      input,
      'portfolio-owner',
      true,
      'IMPORT'
    );

    await controller.restore(input);

    expect(service.run).toHaveBeenLastCalledWith(
      input,
      'portfolio-owner',
      false,
      'IMPORT'
    );
  });

  it('does not impose deletion permissions on existing IMPORT routes', async () => {
    request.user.permissions = allPermissions.filter(
      (permission) =>
        permission !== permissions.deleteAccount &&
        permission !== permissions.deleteActivity
    );

    await controller.preview(input);
    await controller.restore(input);

    expect(service.run).toHaveBeenCalledTimes(2);
  });
});
