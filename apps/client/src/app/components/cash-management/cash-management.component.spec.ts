import {
  CashCsvPreview,
  CashManagementSnapshot,
  ManagedCashEvent
} from '@ghostfolio/common/interfaces';
import { DataService } from '@ghostfolio/ui/services';

import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { CUSTOM_ELEMENTS_SCHEMA, Signal, WritableSignal } from '@angular/core';
import {
  ComponentFixture,
  TestBed,
  fakeAsync,
  flushMicrotasks
} from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { clearTranslations, loadTranslations } from '@angular/localize';
import '@angular/localize/init';
import { MatSelectHarness } from '@angular/material/select/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router, provideRouter } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Observable, Subject, of, throwError } from 'rxjs';

import { GfCashManagementComponent } from './cash-management.component';

jest.mock('@ionic/angular/standalone', () => ({ IonIcon: class {} }));
jest.mock('ionicons', () => ({ addIcons: jest.fn() }));
jest.mock('ionicons/icons', () => ({ ellipsisVertical: 'ellipsis-vertical' }));

jest.mock('@ghostfolio/ui/services', () => ({ DataService: class {} }));

interface CashHarness {
  snapshot: WritableSignal<CashManagementSnapshot | null | undefined>;
  form: FormGroup;
  editing: Signal<string | undefined>;
  csvPreview: WritableSignal<CashCsvPreview | null>;
  save(): void;
  edit(event: ManagedCashEvent): void;
  cancelEdit(): void;
  classificationChanged(): boolean;
  classificationLabel(value: string | null): string;
  cashMessage(message: string): string;
  previewFile(event: Event): Promise<void>;
  error: Signal<string>;
  busy: Signal<boolean>;
  run(request: Observable<CashManagementSnapshot>): void;
}

describe('Cash account request isolation', () => {
  let fixture: ComponentFixture<GfCashManagementComponent>;
  let component: CashHarness;
  let initialA: Subject<CashManagementSnapshot>;
  let recoveryA: Subject<CashManagementSnapshot>;
  let initialB: Subject<CashManagementSnapshot>;
  let fetchCash: jest.Mock;
  const state = (accountId: string): CashManagementSnapshot => ({
    accountId,
    currency: 'EUR',
    defaultUpdateCash: true,
    revision: 1,
    events: [],
    balances: [{ date: '2026-10-01', value: '100' }],
    minimumBalance: { date: '2026-10-01', sequence: 0, value: '100' },
    openingBalance: { date: '2026-10-01', sequence: 0, balance: '100' }
  });

  beforeEach(async () => {
    initialA = new Subject();
    recoveryA = new Subject();
    initialB = new Subject();
    let callsA = 0;
    fetchCash = jest.fn((accountId: string) =>
      accountId === 'A' ? (++callsA === 1 ? initialA : recoveryA) : initialB
    );
    await TestBed.configureTestingModule({
      imports: [GfCashManagementComponent],
      providers: [
        { provide: DataService, useValue: { fetchCashManagement: fetchCash } },
        { provide: Router, useValue: { navigate: jest.fn() } }
      ]
    })
      .overrideComponent(GfCashManagementComponent, {
        set: { template: '', imports: [] }
      })
      .compileComponents();
    fixture = TestBed.createComponent(GfCashManagementComponent);
    component = fixture.componentInstance as unknown as CashHarness;
    fixture.componentRef.setInput('accountId', 'A');
    fixture.detectChanges();
    initialA.next(state('A'));
  });

  function switchToB() {
    fixture.componentRef.setInput('accountId', 'B');
    fixture.detectChanges();
    initialB.next(state('B'));
  }
  function rejectSave() {
    component.run(
      throwError(() => ({ error: { message: 'Rejected A save' } }))
    );
  }

  it('cancels the initial snapshot subscription when the account changes', () => {
    switchToB();
    initialA.next(state('A'));
    expect(component.snapshot()?.accountId).toBe('B');
  });
  it('does not replace account B with a late recovery response from account A', () => {
    rejectSave();
    switchToB();
    recoveryA.next(state('A'));
    expect(component.snapshot()?.accountId).toBe('B');
  });
  it('does not show an obsolete recovery error after the account changes', () => {
    rejectSave();
    switchToB();
    recoveryA.error(new Error('Old A recovery error'));
    expect(component.error()).toBe('');
  });
  it('ignores a late successful mutation from the previously selected account', () => {
    const pending = new Subject<CashManagementSnapshot>();
    component.run(pending);
    switchToB();
    pending.next(state('A'));
    pending.complete();
    expect(component.snapshot()?.accountId).toBe('B');
  });
  it('does not start recovery for a mutation rejected after the account changes', () => {
    const pending = new Subject<CashManagementSnapshot>();
    component.run(pending);
    switchToB();
    pending.error({ error: { message: 'Old save error' } });
    expect(fetchCash.mock.calls.map(([id]) => id)).toEqual(['A', 'B']);
    expect(component.error()).toBe('');
  });
  it('keeps the current-account recovery working', () => {
    rejectSave();
    recoveryA.next({ ...state('A'), revision: 2 });
    expect(component.snapshot()?.revision).toBe(2);
  });
});

const snapshot = (
  accountId = 'A',
  events: ManagedCashEvent[] = []
): CashManagementSnapshot => ({
  accountId,
  currency: 'EUR',
  defaultUpdateCash: true,
  revision: 7,
  events,
  balances: [{ date: '2026-10-01', value: '100' }],
  minimumBalance: { date: '2026-10-01', sequence: 0, value: '100' },
  openingBalance: { date: '2026-10-01', sequence: 0, balance: '100' }
});
const movement = (extra: Partial<ManagedCashEvent> = {}): ManagedCashEvent =>
  ({
    id: 'manual',
    sequence: 1,
    type: 'MOVEMENT',
    date: '2026-10-02',
    amount: '500',
    fee: '2',
    comment: 'Original',
    economicClassification: 'EXTERNAL_CAPITAL',
    ...extra
  }) as ManagedCashEvent;
const preview = (): CashCsvPreview => ({
  accountId: 'A',
  currency: 'EUR',
  revision: 7,
  digest: 'digest',
  rows: [
    {
      line: 2,
      date: '2026-10-02',
      operation: 'DEPOSIT',
      amount: '500',
      economicClassification: 'EXTERNAL_CAPITAL',
      status: 'NEW',
      message: ''
    },
    {
      line: 3,
      date: '2026-10-03',
      operation: 'WITHDRAWAL',
      amount: '3',
      economicClassification: null,
      status: 'NEW',
      message: ''
    },
    {
      line: 4,
      date: '2026-10-04',
      operation: 'RECONCILIATION',
      amount: '600',
      status: 'NEW',
      message: ''
    }
  ],
  newCount: 3,
  existingCount: 0,
  errors: [],
  warnings: [],
  finalBalance: '600',
  minimumBalance: '100'
});

describe('Cash economic classification UI', () => {
  let fixture: ComponentFixture<GfCashManagementComponent>;
  let component: CashHarness;
  let saveCashEvent: jest.Mock;
  let previewCashCsv: jest.Mock;
  const element = () => fixture.nativeElement as HTMLElement;
  const classification = () => component.form.get('economicClassification')!;
  const render = () => {
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
  };
  const validForm = () =>
    component.form.patchValue({ amount: '500', date: '2026-10-02', fee: '2' });

  beforeEach(async () => {
    saveCashEvent = jest.fn(() => of(snapshot()));
    previewCashCsv = jest.fn(() => of(preview()));
    await TestBed.configureTestingModule({
      imports: [GfCashManagementComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: DataService,
          useValue: {
            fetchCashManagement: jest.fn((id: string) => of(snapshot(id))),
            saveCashEvent,
            previewCashCsv
          }
        }
      ]
    })
      .overrideComponent(GfCashManagementComponent, {
        remove: { imports: [IonIcon] },
        add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] }
      })
      .compileComponents();
    fixture = TestBed.createComponent(GfCashManagementComponent);
    component = fixture.componentInstance as unknown as CashHarness;
    fixture.componentRef.setInput('accountId', 'A');
    fixture.componentRef.setInput('canWrite', true);
    fixture.detectChanges();
  });

  function edit(event = movement()) {
    component.snapshot.set(snapshot('A', [event]));
    component.edit(event);
    render();
  }

  it('defaults a new movement to null and displays Unclassified in the actual selector', async () => {
    expect(classification().value).toBeNull();
    const select = await TestbedHarnessEnvironment.loader(fixture).getHarness(
      MatSelectHarness.with({
        selector: '[formControlName="economicClassification"]'
      })
    );
    expect(await select.getValueText()).toBe('Unclassified');
    await select.open();
    expect((await select.getOptions()).length).toBe(4);
  });

  it('creates an unclassified movement with an explicit null', () => {
    validForm();
    component.save();
    expect(saveCashEvent).toHaveBeenCalledWith(
      'A',
      expect.objectContaining({
        type: 'MOVEMENT',
        amount: '500',
        fee: '2',
        economicClassification: null
      }),
      7,
      undefined
    );
  });

  it('creates a fee-only movement with zero principal', () => {
    component.form.patchValue({
      amount: '0',
      fee: '2',
      date: '2026-10-02'
    });

    component.save();

    expect(saveCashEvent).toHaveBeenCalledWith(
      'A',
      expect.objectContaining({
        type: 'MOVEMENT',
        amount: '0',
        fee: '2',
        economicClassification: null
      }),
      7,
      undefined
    );
  });

  it('classifies an existing fee-only movement without changing its amounts', () => {
    edit(
      movement({
        amount: '0',
        fee: '2',
        economicClassification: null
      })
    );

    classification().setValue('EXPENSE');
    component.save();

    expect(saveCashEvent).toHaveBeenCalledWith(
      'A',
      expect.objectContaining({
        type: 'MOVEMENT',
        amount: '0',
        fee: '2',
        economicClassification: 'EXPENSE'
      }),
      7,
      'manual'
    );
  });

  it('explicitly clears the classification of a fee-only movement', () => {
    edit(
      movement({
        amount: '0',
        fee: '2',
        economicClassification: 'EXPENSE'
      })
    );

    classification().setValue(null);
    component.save();

    expect(saveCashEvent).toHaveBeenCalledWith(
      'A',
      expect.objectContaining({
        type: 'MOVEMENT',
        amount: '0',
        fee: '2',
        economicClassification: null
      }),
      7,
      'manual'
    );
  });

  it('rejects a movement with zero principal and zero fee', () => {
    component.form.patchValue({
      amount: '0',
      fee: '0',
      date: '2026-10-02'
    });

    component.save();

    expect(saveCashEvent).not.toHaveBeenCalled();
    expect(component.error()).toContain('Enter a positive amount.');
  });

  it.each(['EXTERNAL_CAPITAL', 'INCOME', 'EXPENSE'])(
    'loads and saves persisted %s exactly',
    (category) => {
      edit(
        movement({
          economicClassification:
            category as ManagedCashEvent['economicClassification']
        })
      );
      expect(classification().value).toBe(category);
      component.save();
      expect(saveCashEvent).toHaveBeenCalledWith(
        'A',
        expect.objectContaining({
          economicClassification: category,
          amount: '500',
          fee: '2'
        }),
        7,
        'manual'
      );
    }
  );

  it('preserves classification for a comment-only edit', () => {
    edit();
    component.form.patchValue({ comment: 'Only note changed' });
    component.save();
    expect(saveCashEvent).toHaveBeenCalledWith(
      'A',
      expect.objectContaining({
        comment: 'Only note changed',
        economicClassification: 'EXTERNAL_CAPITAL'
      }),
      7,
      'manual'
    );
  });

  it('preserves classification for an amount-only edit', () => {
    edit();
    component.form.patchValue({ amount: '700' });
    component.save();
    expect(saveCashEvent).toHaveBeenCalledWith(
      'A',
      expect.objectContaining({
        amount: '700',
        economicClassification: 'EXTERNAL_CAPITAL'
      }),
      7,
      'manual'
    );
  });

  it('explicitly selecting Unclassified sends null and shows the historical warning', async () => {
    edit();
    const select = await TestbedHarnessEnvironment.loader(fixture).getHarness(
      MatSelectHarness.with({
        selector: '[formControlName="economicClassification"]'
      })
    );
    await select.open();
    await select.clickOptions({ text: 'Unclassified' });
    expect(classification().value).toBeNull();
    expect(
      element().querySelector('[data-testid="classification-warning"]')
        ?.textContent
    ).toContain('historical portfolio performance');
    component.save();
    expect(saveCashEvent).toHaveBeenCalledWith(
      'A',
      expect.objectContaining({ economicClassification: null }),
      7,
      'manual'
    );
  });

  it('warns only when an existing classification differs, including an unclassified historical movement', () => {
    edit(movement({ economicClassification: null }));
    expect(
      element().querySelector('[data-testid="classification-warning"]')
    ).toBeNull();
    classification().setValue('INCOME');
    render();
    expect(
      element().querySelector('[data-testid="classification-warning"]')
    ).not.toBeNull();
    classification().setValue(null);
    render();
    expect(
      element().querySelector('[data-testid="classification-warning"]')
    ).toBeNull();
    component.cancelEdit();
    validForm();
    classification().setValue('EXPENSE');
    render();
    expect(
      element().querySelector('[data-testid="classification-warning"]')
    ).toBeNull();
  });

  it('keeps direction and classification independent, including income reversals', () => {
    validForm();
    classification().setValue('INCOME');
    component.form.patchValue({ operation: 'WITHDRAWAL' });
    component.save();
    expect(saveCashEvent).toHaveBeenCalledWith(
      'A',
      expect.objectContaining({
        amount: '-500',
        economicClassification: 'INCOME'
      }),
      7,
      undefined
    );
  });

  it('does not infer a category from direction or comments', () => {
    validForm();
    component.form.patchValue({
      operation: 'WITHDRAWAL',
      comment: 'Dividend deposit income'
    });
    expect(classification().value).toBeNull();
    component.save();
    expect(saveCashEvent).toHaveBeenCalledWith(
      'A',
      expect.objectContaining({ economicClassification: null }),
      7,
      undefined
    );
  });

  it('blocks invalid categories with localized form validation', () => {
    validForm();
    classification().setValue('OTHER');
    classification().markAsTouched();
    render();
    expect(element().querySelector('mat-error')?.textContent).toContain(
      'Select a valid economic classification.'
    );
    component.save();
    expect(saveCashEvent).not.toHaveBeenCalled();
  });

  it('hides the field for a checkpoint and sends null', () => {
    const checkpoint: ManagedCashEvent = {
      id: 'checkpoint',
      type: 'CHECKPOINT',
      balance: '700',
      date: '2026-10-02',
      sequence: 1
    };
    edit(checkpoint);
    expect(
      element().querySelector('[formControlName="economicClassification"]')
    ).toBeNull();
    component.save();
    expect(saveCashEvent).toHaveBeenCalledWith(
      'A',
      expect.objectContaining({
        type: 'CHECKPOINT',
        balance: '700',
        economicClassification: null
      }),
      7,
      'checkpoint'
    );
  });

  it('requires explicit clearing before converting a classified movement to a checkpoint', () => {
    edit();
    component.form.patchValue({ operation: 'CHECKPOINT' });
    render();
    expect(classification().value).toBe('EXTERNAL_CAPITAL');
    expect(
      element().querySelector('[formControlName="economicClassification"]')
    ).toBeNull();
    component.save();
    expect(saveCashEvent).not.toHaveBeenCalled();
    expect(component.error()).toContain(
      'Clear the economic classification explicitly'
    );
    const clear = Array.from(element().querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Clear classification'
    )!;
    clear.click();
    component.save();
    expect(saveCashEvent).toHaveBeenCalledWith(
      'A',
      expect.objectContaining({
        type: 'CHECKPOINT',
        economicClassification: null
      }),
      7,
      'manual'
    );
  });

  it.each([
    { orderId: 'order' },
    { transferId: 'transfer' },
    {
      transferCounterparty: {
        accountId: 'B',
        mode: 'CASH' as const,
        amount: '500',
        currency: 'EUR'
      }
    }
  ])('does not edit or classify linked events %j', (link) => {
    const linked = movement({ ...link, economicClassification: null });
    component.snapshot.set(snapshot('A', [linked]));
    component.edit(linked);
    render();
    expect(component.editing()).toBeUndefined();
    expect(classification().value).toBeNull();
    expect(
      element()
        .querySelector('[data-testid="event-classification"]')
        ?.textContent?.trim()
    ).toBe('—');
  });

  it('resets the category on cancel, successful save, and subsequent new movement', () => {
    edit();
    component.cancelEdit();
    render();
    expect(classification().value).toBeNull();
    edit();
    component.save();
    render();
    expect(classification().value).toBeNull();
    expect(component.editing()).toBeUndefined();
    validForm();
    expect(classification().value).toBeNull();
  });

  it('loads each event independently, including old records that omit classification', () => {
    edit();
    edit(movement({ id: 'legacy', economicClassification: undefined }));
    expect(classification().value).toBeNull();
  });

  it('resets form and preview when switching accounts', () => {
    edit();
    component.csvPreview.set(preview());
    fixture.componentRef.setInput('accountId', 'B');
    render();
    expect(component.editing()).toBeUndefined();
    expect(classification().value).toBeNull();
    expect(component.csvPreview()).toBeNull();
    expect(component.snapshot()?.accountId).toBe('B');
  });

  it('ignores a delayed save response after account switching, including category state', () => {
    const pending = new Subject<CashManagementSnapshot>();
    saveCashEvent.mockReturnValue(pending);
    edit();
    component.save();
    fixture.componentRef.setInput('accountId', 'B');
    render();
    pending.next(snapshot('A', [movement()]));
    pending.complete();
    render();
    expect(component.snapshot()?.accountId).toBe('B');
    expect(classification().value).toBeNull();
    expect(component.busy()).toBe(false);
  });

  it('ignores a delayed CSV preview response from the previous account', async () => {
    const pending = new Subject<CashCsvPreview>();
    previewCashCsv.mockReturnValue(pending);
    await component.previewFile({
      target: {
        files: [
          { name: 'cash.csv', size: 10, text: () => Promise.resolve('CSV') }
        ],
        value: 'cash.csv'
      }
    } as unknown as Event);
    fixture.componentRef.setInput('accountId', 'B');
    render();
    pending.next(preview());
    render();
    expect(component.csvPreview()).toBeNull();
    expect(component.busy()).toBe(false);
  });

  it('does not submit a file read that finishes after switching accounts', fakeAsync(() => {
    let resolve!: (value: string) => void;
    void component.previewFile({
      target: {
        files: [
          {
            name: 'cash.csv',
            size: 10,
            text: () =>
              new Promise<string>((done) => {
                resolve = done;
              })
          }
        ],
        value: 'cash.csv'
      }
    } as unknown as Event);
    fixture.componentRef.setInput('accountId', 'B');
    render();
    resolve('OLD CSV');
    flushMicrotasks();
    expect(previewCashCsv).not.toHaveBeenCalled();
    expect(component.csvPreview()).toBeNull();
  }));

  it('presents categories separately from direction and treats legacy events neutrally', () => {
    component.snapshot.set(
      snapshot('A', [
        movement(),
        movement({ id: 'income', economicClassification: 'INCOME' }),
        movement({ id: 'expense', economicClassification: 'EXPENSE' }),
        movement({ id: 'old', economicClassification: undefined })
      ])
    );
    render();
    expect(
      Array.from(
        element().querySelectorAll('[data-testid="event-classification"]')
      ).map((e) => e.textContent?.trim())
    ).toEqual(['Unclassified', 'Expense', 'Income', 'External capital']);
    expect(element().textContent).not.toContain('EXTERNAL_CAPITAL');
    expect(element().textContent).toContain(
      'Choose the economic classification independently.'
    );
  });

  it('localizes classification conflicts in CSV preview without displaying internal field names', () => {
    const data = preview();
    const conflict =
      'Economic classification conflicts with the existing movement. Use an explicit edit; no overwrite is performed.';
    data.rows[0].message = conflict;
    data.rows[0].status = 'ERROR';
    data.errors = [`Row 2: ${conflict}`];
    component.csvPreview.set(data);
    render();
    expect(element().textContent).toContain(
      '2: This movement already has a different economic classification.'
    );
    expect(element().textContent).not.toContain(
      'Use an explicit edit; no overwrite is performed.'
    );
  });

  it('localizes API classification validation errors and preserves the draft on failure', () => {
    edit();
    saveCashEvent.mockReturnValue(
      throwError(() => ({
        error: {
          message: [
            'economicClassification must be a supported category on a manual MOVEMENT'
          ]
        }
      }))
    );
    component.save();
    expect(component.error()).toBe('Select a valid economic classification.');
    expect(classification().value).toBe('EXTERNAL_CAPITAL');
  });

  it('shows categories and unclassified rows in CSV preview, without classifying reconciliations', () => {
    component.csvPreview.set(preview());
    render();
    expect(
      Array.from(
        element().querySelectorAll('[data-testid="csv-classification"]')
      ).map((e) => e.textContent?.trim())
    ).toEqual(['External capital', 'Unclassified', '—']);
  });
});

describe('Cash classification English and Italian localization', () => {
  const locales = join(__dirname, '../../../locales');
  const catalog = (name: string) =>
    new DOMParser().parseFromString(
      readFileSync(join(locales, name), 'utf8'),
      'application/xml'
    );
  afterEach(() => clearTranslations());

  it('has complete, unique English sources and Italian translations for every new message', () => {
    const source =
      readFileSync(join(__dirname, 'cash-management.component.ts'), 'utf8') +
      readFileSync(join(__dirname, 'cash-management.component.html'), 'utf8');
    const ids = [
      ...new Set(
        Array.from(source.matchAll(/@@(cash[A-Za-z]+)/g), (match) => match[1])
      )
    ];
    expect(ids).toHaveLength(13);
    const en = catalog('messages.xlf');
    const it = catalog('messages.it.xlf');
    expect(en.querySelector('parsererror')).toBeNull();
    expect(it.querySelector('parsererror')).toBeNull();
    for (const id of ids) {
      expect(en.querySelectorAll(`trans-unit[id="${id}"]`)).toHaveLength(1);
      expect(it.querySelectorAll(`trans-unit[id="${id}"]`)).toHaveLength(1);
      const english = en.querySelector(
        `trans-unit[id="${id}"] source`
      )!.textContent;
      const unit = it.querySelector(`trans-unit[id="${id}"]`)!;
      expect(unit.querySelector('source')!.textContent).toBe(english);
      expect(
        unit.querySelector('target')!.textContent!.trim().length
      ).toBeGreaterThan(0);
      expect(unit.querySelector('target')!.getAttribute('state')).toBe(
        'translated'
      );
    }
  });

  it('uses the Italian catalog for all four runtime labels without enum identifiers', () => {
    const it = catalog('messages.it.xlf');
    loadTranslations(
      Object.fromEntries(
        Array.from(
          it.querySelectorAll('trans-unit[id^="cashClassification"]')
        ).map((unit) => [unit.id, unit.querySelector('target')!.textContent!])
      )
    );
    const message = GfCashManagementComponent.prototype['cashMessage'];
    expect(message.call(null, 'Unsupported EconomicClassification.')).toBe(
      'Seleziona una classificazione economica valida.'
    );
    expect(
      message.call(null, 'EconomicClassification requires cash CSV version 2.')
    ).toBe('La classificazione economica richiede la versione 2 del CSV.');
    expect(
      message.call(
        null,
        'EconomicClassification is only allowed on manual movement rows.'
      )
    ).toBe(
      'La classificazione economica è disponibile solo per i movimenti di cassa manuali.'
    );
    expect(
      message.call(
        null,
        'Row 2: Economic classification conflicts with the existing movement. Use an explicit edit; no overwrite is performed.'
      )
    ).toBe(
      '2: Questo movimento ha già una classificazione economica diversa. Modifica esplicitamente il movimento: l’importazione non lo sovrascriverà.'
    );
    const label = GfCashManagementComponent.prototype['classificationLabel'];
    expect(
      [null, 'EXTERNAL_CAPITAL', 'INCOME', 'EXPENSE'].map((value) =>
        label.call(null, value)
      )
    ).toEqual(['Non classificato', 'Capitale esterno', 'Provento', 'Spesa']);
  });
});
