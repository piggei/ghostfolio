import { COMMENT_MAXIMUM_LENGTH } from '@ghostfolio/common/config';
import { DATE_FORMAT } from '@ghostfolio/common/helper';
import {
  CashEventInput,
  CashManagementSnapshot,
  ManagedCashEvent
} from '@ghostfolio/common/interfaces';
import { internalRoutes } from '@ghostfolio/common/routes/routes';
import { DataService } from '@ghostfolio/ui/services';

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormControl,
  FormGroup,
  FormGroupDirective,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { Router } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { Big } from 'big.js';
import { format } from 'date-fns';
import { addIcons } from 'ionicons';
import { ellipsisVertical } from 'ionicons/icons';
import { finalize, Observable } from 'rxjs';

@Component({
  selector: 'gf-cash-management',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatMenuModule,
    IonIcon
  ],
  templateUrl: './cash-management.component.html',
  styleUrls: ['./cash-management.component.scss']
})
export class GfCashManagementComponent {
  public readonly accountId = input.required<string>();
  public readonly currentBalance = input<number>(0);
  public readonly currency = input<string | null>();
  public readonly canWrite = input(false);
  public readonly changed = output<void>();

  protected readonly COMMENT_MAXIMUM_LENGTH = COMMENT_MAXIMUM_LENGTH;
  protected readonly today = format(new Date(), DATE_FORMAT);
  protected readonly snapshot = signal<
    CashManagementSnapshot | null | undefined
  >(undefined);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly editing = signal<string | undefined>(undefined);
  protected readonly orderedEvents = () =>
    [...(this.snapshot()?.events ?? [])].reverse();
  protected readonly form = new FormGroup({
    operation: new FormControl('DEPOSIT', { nonNullable: true }),
    date: new FormControl(this.today, {
      nonNullable: true,
      validators: [Validators.required]
    }),
    amount: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^-?\d+(\.\d+)?$/)]
    }),
    comment: new FormControl('', { nonNullable: true })
  });
  private readonly dataService = inject(DataService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly formDirective = viewChild(FormGroupDirective);
  private readonly router = inject(Router);

  public constructor() {
    addIcons({ ellipsisVertical });
    effect(() => {
      const accountId = this.accountId();
      this.dataService
        .fetchCashManagement(accountId)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (snapshot) => this.snapshot.set(snapshot),
          error: () =>
            this.error.set($localize`Unable to load cash transactions.`)
        });
    });
  }

  protected save() {
    const state = this.snapshot();
    if (!state || this.form.invalid || this.busy()) {
      return;
    }
    const { operation, amount, date, comment } = this.form.getRawValue();
    const value = new Big(amount);
    if (operation !== 'CHECKPOINT' && !value.gt(0)) {
      this.error.set($localize`Enter a positive amount.`);
      return;
    }
    const event: CashEventInput =
      operation === 'CHECKPOINT'
        ? { type: 'CHECKPOINT', balance: value.toString(), date, comment }
        : {
            type: 'MOVEMENT',
            amount: (operation === 'WITHDRAWAL'
              ? value.neg()
              : value
            ).toString(),
            date,
            comment
          };
    this.run(
      this.dataService.saveCashEvent(
        this.accountId(),
        event,
        state.revision,
        this.editing()
      )
    );
  }

  protected edit(event: ManagedCashEvent) {
    this.editing.set(event.id);
    const value =
      event.type === 'CHECKPOINT'
        ? new Big(event.balance)
        : new Big(event.amount);
    this.form.setValue({
      operation:
        event.type === 'CHECKPOINT'
          ? 'CHECKPOINT'
          : value.lt(0)
            ? 'WITHDRAWAL'
            : 'DEPOSIT',
      date: event.date,
      amount: (event.type === 'CHECKPOINT' ? value : value.abs()).toFixed(),
      comment: event.comment ?? ''
    });
  }

  protected cancelEdit() {
    this.editing.set(undefined);
    this.formDirective()?.resetForm({
      operation: 'DEPOSIT',
      date: this.today,
      amount: '',
      comment: ''
    });
  }

  protected remove(event: ManagedCashEvent) {
    const state = this.snapshot();
    if (state && !this.busy()) {
      this.run(
        this.dataService.deleteCashEvent(
          this.accountId(),
          event.id,
          state.revision
        )
      );
    }
  }

  protected preferences(change: {
    defaultUpdateCash?: boolean;
    includeCashInPortfolio?: boolean;
  }) {
    const state = this.snapshot();
    if (state && !this.busy()) {
      this.run(
        this.dataService.updateCashPreferences(
          this.accountId(),
          state.revision,
          change.defaultUpdateCash,
          change.includeCashInPortfolio
        )
      );
    }
  }

  protected eventLabel(event: ManagedCashEvent) {
    if (event.orderId) {
      return $localize`Activity`;
    }
    if (event.transferId) {
      return $localize`Transfer`;
    }
    if (event.type === 'CHECKPOINT') {
      return $localize`Reconciliation`;
    }
    return new Big(event.amount).lt(0)
      ? $localize`Withdrawal`
      : $localize`Deposit`;
  }

  protected openSource(event: ManagedCashEvent) {
    if (event.orderId) {
      void this.router.navigate(
        internalRoutes.portfolio.subRoutes.activities.subRoutes.update.routerLink(
          event.orderId
        )
      );
    } else {
      this.error.set(
        $localize`This transfer has a matching entry in the other account. Use a new transfer to reverse it.`
      );
    }
  }

  protected balanceAfter(event: ManagedCashEvent) {
    const state = this.snapshot();
    let balance = new Big(state?.openingBalance.balance ?? 0);
    for (const item of state?.events ?? []) {
      balance =
        item.type === 'CHECKPOINT'
          ? new Big(item.balance)
          : balance.plus(item.amount);
      if (item.id === event.id) {
        return balance.toFixed();
      }
    }
    return balance.toFixed();
  }

  protected eventAmount(event: ManagedCashEvent) {
    return new Big(
      event.type === 'CHECKPOINT' ? event.balance : event.amount
    ).toFixed();
  }

  private run(request: Observable<CashManagementSnapshot>) {
    this.busy.set(true);
    this.error.set('');
    request
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.busy.set(false))
      )
      .subscribe({
        next: (state) => {
          this.snapshot.set(state);
          this.cancelEdit();
          this.changed.emit();
        },
        error: (error) => {
          const message = error.error?.message;
          this.error.set(
            typeof message === 'string'
              ? message
              : $localize`Unable to save. Reload the account and try again.`
          );
          // A stale revision needs a fresh snapshot and a new user decision.
          this.dataService
            .fetchCashManagement(this.accountId())
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((state) => this.snapshot.set(state));
        }
      });
  }
}
