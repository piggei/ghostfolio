import { ImpersonationStorageService } from '@ghostfolio/client/services/impersonation-storage.service';
import { SettingsStorageService } from '@ghostfolio/client/services/settings-storage.service';
import { UserService } from '@ghostfolio/client/services/user/user.service';
import { WebAuthnService } from '@ghostfolio/client/services/web-authn.service';
import { permissions } from '@ghostfolio/common/permissions';
import { PerformanceCalculationType } from '@ghostfolio/common/types/performance-calculation-type.type';
import { NotificationService } from '@ghostfolio/ui/notifications';
import { DataService } from '@ghostfolio/ui/services';
import { GfValueComponent } from '@ghostfolio/ui/value';

import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSelect } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { DeviceDetectorService } from 'ngx-device-detector';
import { of } from 'rxjs';

import { GfUserAccountSettingsComponent } from './user-account-settings.component';

jest.mock('@ionic/angular/standalone', () => ({ IonIcon: class {} }));
jest.mock('ionicons', () => ({ addIcons: jest.fn() }));
jest.mock('ionicons/icons', () => ({ eyeOffOutline: '', eyeOutline: '' }));
jest.mock(
  '../portfolio-restore-dialog/portfolio-restore-dialog.component',
  () => ({ GfPortfolioRestoreDialogComponent: class {} })
);

describe('NG benchmark settings selector', () => {
  async function create(
    ng: boolean,
    experimental = true,
    options: {
      userPermissions?: string[];
      impersonated?: boolean;
      restricted?: boolean;
    } = {}
  ) {
    const user = {
      id: 'user',
      permissions: options.userPermissions ?? [],
      settings: {
        baseCurrency: 'EUR',
        isExperimentalFeatures: experimental,
        isRestrictedView: options.restricted ?? false,
        performanceCalculationType: PerformanceCalculationType.ROAI
      }
    };
    const putUserSetting = jest.fn().mockReturnValue(of({}));
    await TestBed.configureTestingModule({
      imports: [GfUserAccountSettingsComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: DataService,
          useValue: {
            fetchInfo: () => ({ currencies: ['EUR'], isGhostfolioNg: ng }),
            putUserSetting
          }
        },
        {
          provide: UserService,
          useValue: { stateChanged: of({ user }), get: () => of(user) }
        },
        {
          provide: ImpersonationStorageService,
          useValue: {
            onChangeHasImpersonation: () => of(options.impersonated ?? false)
          }
        },
        {
          provide: SettingsStorageService,
          useValue: { getSetting: () => undefined }
        },
        { provide: WebAuthnService, useValue: { isEnabled: () => false } },
        {
          provide: DeviceDetectorService,
          useValue: { deviceInfo: () => ({ deviceType: 'desktop' }) }
        },
        { provide: NotificationService, useValue: {} },
        { provide: MatSnackBar, useValue: {} }
      ]
    })
      .overrideComponent(GfUserAccountSettingsComponent, {
        remove: { imports: [IonIcon, GfValueComponent] }
      })
      .compileComponents();
    const dialogOpen = jest
      .spyOn(TestBed.inject(MatDialog), 'open')
      .mockImplementation(() => null!);

    const fixture = TestBed.createComponent(GfUserAccountSettingsComponent);
    fixture.detectChanges();
    const element = fixture.debugElement.query(
      By.css('mat-select[name="benchmarkComparisonMode"]')
    );
    return {
      fixture,
      user,
      putUserSetting,
      dialogOpen,
      select: element?.componentInstance as MatSelect | undefined
    };
  }

  it('hides NG methods in the standard distribution', async () => {
    const { select } = await create(false);
    expect(select.options.map(({ value }) => value)).toEqual([
      'TRADITIONAL',
      'ACTIVITY_MATCHED_ROI',
      'ACTIVITY_MATCHED_ROAI'
    ]);
  });

  it('requires experimental features even in NG', async () => {
    const { select } = await create(true, false);
    expect(select).toBeUndefined();
  });

  it('shows annualized MWR and cumulative TWR only in NG without changing portfolio performance', async () => {
    const { fixture, select, user, putUserSetting } = await create(true);
    expect(select.options.map(({ value }) => value)).toEqual([
      'TRADITIONAL',
      'ACTIVITY_MATCHED_ROI',
      'ACTIVITY_MATCHED_ROAI',
      'ACTIVITY_MATCHED_MWR',
      'ACTIVITY_MATCHED_TWR'
    ]);
    expect(
      select.options.find(({ value }) => value === 'ACTIVITY_MATCHED_MWR')
        .viewValue
    ).toContain('annualized');
    expect(
      select.options.find(({ value }) => value === 'ACTIVITY_MATCHED_TWR')
        .viewValue
    ).toContain('cumulative');
    select.selectionChange.emit({
      source: select,
      value: 'ACTIVITY_MATCHED_TWR'
    });
    fixture.detectChanges();
    expect(putUserSetting).toHaveBeenCalledWith({
      benchmarkComparisonMode: 'ACTIVITY_MATCHED_TWR'
    });
    expect(user.settings.performanceCalculationType).toBe(
      PerformanceCalculationType.ROAI
    );
  });

  const replacementPermissions = [
    permissions.createAccount,
    permissions.createActivity,
    permissions.deleteAccount,
    permissions.deleteActivity
  ];

  function actionButton(
    fixture: Awaited<ReturnType<typeof create>>['fixture'],
    label: string
  ): HTMLButtonElement | undefined {
    return Array.from(
      fixture.nativeElement.querySelectorAll(
        'button'
      ) as NodeListOf<HTMLButtonElement>
    ).find((button) => button.textContent?.trim() === label);
  }

  it('opens the original import dialog in IMPORT mode', async () => {
    const { fixture, dialogOpen } = await create(true);

    const button = actionButton(fixture, 'Import Data');

    expect(button).toBeDefined();
    button!.click();

    expect(dialogOpen).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        disableClose: true,
        data: { mode: 'IMPORT' }
      })
    );
  });

  it('shows and opens Replace Data for an authorized user', async () => {
    const { fixture, dialogOpen } = await create(true, true, {
      userPermissions: replacementPermissions
    });

    expect(actionButton(fixture, 'Export Data')).toBeDefined();
    expect(actionButton(fixture, 'Import Data')).toBeDefined();

    const button = actionButton(fixture, 'Replace Data');

    expect(button).toBeDefined();
    button!.click();

    expect(dialogOpen).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        disableClose: true,
        data: { mode: 'REPLACE' }
      })
    );
  });

  it('hides replacement when a required permission is missing', async () => {
    for (const missingPermission of replacementPermissions) {
      const { fixture, dialogOpen } = await create(true, true, {
        userPermissions: replacementPermissions.filter(
          (permission) => permission !== missingPermission
        )
      });

      expect(actionButton(fixture, 'Export Data')).toBeDefined();
      expect(actionButton(fixture, 'Import Data')).toBeDefined();
      expect(actionButton(fixture, 'Replace Data')).toBeUndefined();

      fixture.componentInstance['onReplaceData']();

      expect(dialogOpen).not.toHaveBeenCalled();

      TestBed.resetTestingModule();
    }
  });

  it('hides import and replacement during impersonation', async () => {
    const { fixture, dialogOpen } = await create(true, true, {
      userPermissions: replacementPermissions,
      impersonated: true
    });

    expect(actionButton(fixture, 'Export Data')).toBeDefined();
    expect(actionButton(fixture, 'Import Data')).toBeUndefined();
    expect(actionButton(fixture, 'Replace Data')).toBeUndefined();

    fixture.componentInstance['onReplaceData']();

    expect(dialogOpen).not.toHaveBeenCalled();
  });

  it('hides import and replacement in restricted view', async () => {
    const { fixture, dialogOpen } = await create(true, true, {
      userPermissions: replacementPermissions,
      restricted: true
    });

    expect(actionButton(fixture, 'Export Data')).toBeDefined();
    expect(actionButton(fixture, 'Import Data')).toBeUndefined();
    expect(actionButton(fixture, 'Replace Data')).toBeUndefined();

    fixture.componentInstance['onReplaceData']();

    expect(dialogOpen).not.toHaveBeenCalled();
  });
});
