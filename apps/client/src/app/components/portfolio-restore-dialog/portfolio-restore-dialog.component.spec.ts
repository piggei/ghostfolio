import { UserService } from '@ghostfolio/client/services/user/user.service';

import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { MatCheckboxHarness } from '@angular/material/checkbox/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';

import { GfPortfolioRestoreDialogComponent } from './portfolio-restore-dialog.component';

// Prevent the real UserService dependency graph from loading Ionic in Jest.
jest.mock('@ghostfolio/client/services/user/user.service', () => ({
  UserService: class UserService {}
}));

describe('PortfolioRestoreDialog modes', () => {
  const backup = {
    accounts: [
      { id: 'source-1', name: 'Broker', currency: 'EUR' },
      { id: 'source-2', name: 'Cash', currency: 'EUR' }
    ],
    activities: []
  };

  const replacement = {
    accountsToDelete: 3,
    activitiesToDelete: 7,
    cashEventsToDelete: 2
  };

  const preview = {
    digest: 'verified-digest',
    accounts: [],
    destinationAccounts: [],
    activities: 0,
    newActivities: 0,
    duplicates: 0,
    cashEvents: 0,
    errors: [],
    warnings: [],
    replacement
  };

  let initial: Record<string, unknown>;
  let post: jest.Mock;
  let close: jest.Mock;
  let getUser: jest.Mock;

  beforeEach(() => {
    initial = {};
    post = jest.fn().mockReturnValue(of(preview));
    close = jest.fn();
    getUser = jest.fn().mockReturnValue(of({}));

    TestBed.configureTestingModule({
      providers: [
        { provide: MAT_DIALOG_DATA, useFactory: () => initial },
        { provide: HttpClient, useValue: { post } },
        { provide: MatDialogRef, useValue: { close } },
        { provide: UserService, useValue: { get: getUser } }
      ]
    });
  });

  function create(mode: 'IMPORT' | 'REPLACE' = 'IMPORT') {
    initial = { mode, backup, fileName: 'portfolio.json' };

    const component = TestBed.runInInjectionContext(
      () => new GfPortfolioRestoreDialogComponent()
    );

    // Simulate a backup already loaded with NEW account choices.
    component['backup'].set(backup);
    component['choices'] = {
      'source-1': 'NEW',
      'source-2': 'NEW'
    };

    return component;
  }

  it('uses the original import endpoint and preserves import settings', async () => {
    const component = create('IMPORT');

    await component['loadPreview']();

    expect(post).toHaveBeenCalledWith(
      '/api/v1/import/restore/preview',
      expect.objectContaining({
        restoreSettings: true,
        choices: [
          { sourceId: 'source-1', targetId: 'NEW' },
          { sourceId: 'source-2', targetId: 'NEW' }
        ]
      })
    );
  });

  it('uses replacement preview and never restores user settings', async () => {
    const component = create('REPLACE');

    await component['loadPreview']();

    expect(post).toHaveBeenCalledWith(
      '/api/v1/import/restore/replace/preview',
      expect.objectContaining({
        restoreSettings: false,
        choices: [
          { sourceId: 'source-1', targetId: 'NEW' },
          { sourceId: 'source-2', targetId: 'NEW' }
        ]
      })
    );
  });

  it('does not submit replacement before explicit confirmation', async () => {
    const component = create('REPLACE');

    await component['loadPreview']();
    await component['restore']();

    expect(post).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it('submits replacement with the preview digest after confirmation', async () => {
    const component = create('REPLACE');

    await component['loadPreview']();
    component['replaceConfirmed'].set(true);

    await component['restore']();

    expect(post).toHaveBeenLastCalledWith(
      '/api/v1/import/restore/replace',
      expect.objectContaining({
        digest: 'verified-digest',
        restoreSettings: false
      })
    );
    expect(getUser).toHaveBeenCalledWith(true);
    expect(close).toHaveBeenCalledWith(true);
  });

  it('rejects replacement confirmation without deletion counts', async () => {
    post.mockReturnValue(of({ ...preview, replacement: undefined }));

    const component = create('REPLACE');

    await component['loadPreview']();
    component['replaceConfirmed'].set(true);
    await component['restore']();

    expect(post).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it('invalidates the previous confirmation when preview is refreshed', async () => {
    const component = create('REPLACE');

    await component['loadPreview']();
    component['replaceConfirmed'].set(true);

    await component['loadPreview']();

    expect(component['replaceConfirmed']()).toBe(false);

    await component['restore']();

    expect(post).toHaveBeenCalledTimes(2);
    expect(close).not.toHaveBeenCalled();
  });

  it('clears preview and confirmation after a failed replacement', async () => {
    const component = create('REPLACE');

    await component['loadPreview']();
    component['replaceConfirmed'].set(true);

    post.mockReturnValueOnce(
      throwError(() => new Error('Replacement rejected'))
    );

    await component['restore']();

    expect(component['preview']()).toBeNull();
    expect(component['replaceConfirmed']()).toBe(false);
    expect(component['error']()).toContain('Replacement rejected');
    expect(close).not.toHaveBeenCalled();
  });

  it('renders replacement disabled before preview', async () => {
    initial = { mode: 'REPLACE' };

    TestBed.configureTestingModule({
      imports: [GfPortfolioRestoreDialogComponent]
    });

    await TestBed.compileComponents();

    const fixture = TestBed.createComponent(GfPortfolioRestoreDialogComponent);

    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const button = Array.from(element.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === 'Replace Data'
    );

    expect(element.querySelector('h2')?.textContent?.trim()).toBe(
      'Replace Data'
    );
    expect(button).toBeDefined();
    expect(button?.disabled).toBe(true);
    expect(element.querySelector('mat-checkbox')).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it('renders deletion counts and requires confirmation before enabling replacement', async () => {
    initial = { mode: 'REPLACE' };

    TestBed.configureTestingModule({
      imports: [GfPortfolioRestoreDialogComponent]
    });

    await TestBed.compileComponents();

    const fixture = TestBed.createComponent(GfPortfolioRestoreDialogComponent);

    const component = fixture.componentInstance;

    component['backup'].set(backup);
    component['preview'].set({
      ...preview,
      accounts: [
        {
          sourceId: 'source-1',
          name: 'Broker',
          currency: 'EUR',
          targetId: null,
          action: 'NEW',
          cashEvents: 0,
          cashBalance: null
        },
        {
          sourceId: 'source-2',
          name: 'Cash',
          currency: 'EUR',
          targetId: null,
          action: 'NEW',
          cashEvents: 0,
          cashBalance: null
        }
      ],
      newActivities: 4,
      cashEvents: 1
    });

    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const button = Array.from(element.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === 'Replace Data'
    );

    const summary = element.querySelector('section[aria-live="polite"]');

    expect(summary?.textContent).toContain('Existing data to delete:');
    expect(summary?.textContent).toContain('3 accounts');
    expect(summary?.textContent).toContain('7 activities');
    expect(summary?.textContent).toContain('2 cash movements');
    expect(summary?.textContent).toContain('Data to import:');
    expect(summary?.textContent).not.toContain('Already present:');

    expect(element.querySelector('mat-checkbox')).not.toBeNull();
    expect(button?.disabled).toBe(true);

    component['replaceConfirmed'].set(true);
    fixture.detectChanges();

    expect(button?.disabled).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it('updates replacement confirmation through the rendered checkbox', async () => {
    initial = { mode: 'REPLACE' };

    TestBed.configureTestingModule({
      imports: [GfPortfolioRestoreDialogComponent]
    });

    await TestBed.compileComponents();

    const fixture = TestBed.createComponent(GfPortfolioRestoreDialogComponent);

    const component = fixture.componentInstance;

    component['preview'].set(preview);
    fixture.detectChanges();

    const loader = TestbedHarnessEnvironment.loader(fixture);
    const checkbox = await loader.getHarness(MatCheckboxHarness);

    const element = fixture.nativeElement as HTMLElement;
    const button = Array.from(element.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === 'Replace Data'
    );

    expect(button).toBeDefined();
    expect(await checkbox.isChecked()).toBe(false);
    expect(component['replaceConfirmed']()).toBe(false);
    expect(button?.disabled).toBe(true);

    await checkbox.check();
    fixture.detectChanges();

    expect(await checkbox.isChecked()).toBe(true);
    expect(component['replaceConfirmed']()).toBe(true);
    expect(button?.disabled).toBe(false);

    await checkbox.uncheck();
    fixture.detectChanges();

    expect(await checkbox.isChecked()).toBe(false);
    expect(component['replaceConfirmed']()).toBe(false);
    expect(button?.disabled).toBe(true);

    expect(post).not.toHaveBeenCalled();
  });

  it('keeps the original import confirmation flow', async () => {
    const component = create('IMPORT');

    await component['loadPreview']();
    await component['restore']();

    expect(post).toHaveBeenLastCalledWith(
      '/api/v1/import/restore',
      expect.objectContaining({
        digest: 'verified-digest',
        restoreSettings: true
      })
    );
    expect(close).toHaveBeenCalledWith(true);
  });
});
