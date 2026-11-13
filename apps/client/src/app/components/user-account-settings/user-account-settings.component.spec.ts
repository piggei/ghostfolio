import { ImpersonationStorageService } from '@ghostfolio/client/services/impersonation-storage.service';
import { SettingsStorageService } from '@ghostfolio/client/services/settings-storage.service';
import { UserService } from '@ghostfolio/client/services/user/user.service';
import { WebAuthnService } from '@ghostfolio/client/services/web-authn.service';
import { PerformanceCalculationType } from '@ghostfolio/common/types/performance-calculation-type.type';
import { NotificationService } from '@ghostfolio/ui/notifications';
import { DataService } from '@ghostfolio/ui/services';
import { GfValueComponent } from '@ghostfolio/ui/value';

import { TestBed } from '@angular/core/testing';
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
  async function create(ng: boolean, experimental = true) {
    const user = {
      id: 'user',
      permissions: [],
      settings: {
        baseCurrency: 'EUR',
        isExperimentalFeatures: experimental,
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
          useValue: { onChangeHasImpersonation: () => of(false) }
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
    const fixture = TestBed.createComponent(GfUserAccountSettingsComponent);
    fixture.detectChanges();
    const element = fixture.debugElement.query(
      By.css('mat-select[name="benchmarkComparisonMode"]')
    );
    return {
      fixture,
      user,
      putUserSetting,
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
});
