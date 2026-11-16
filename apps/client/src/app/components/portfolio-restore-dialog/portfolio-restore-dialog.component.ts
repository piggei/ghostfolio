import { UserService } from '@ghostfolio/client/services/user/user.service';
import {
  CreateAccountWithBalancesDto,
  CreateAssetProfileWithMarketDataDto,
  CreateOrderDto,
  CreatePlatformDto,
  CreateTagDto
} from '@ghostfolio/common/dtos';

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';

interface Backup {
  accounts?: CreateAccountWithBalancesDto[];
  activities: CreateOrderDto[];
  assetProfiles?: CreateAssetProfileWithMarketDataDto[];
  platforms?: CreatePlatformDto[];
  tags?: CreateTagDto[];
  user?: {
    settings?: { currency?: string; performanceCalculationType?: string };
  };
}
interface RestorePreview {
  digest: string;
  accounts: {
    sourceId: string;
    name: string;
    currency: string;
    targetId: string | null;
    action: string;
    cashEvents: number;
    cashBalance: string | null;
  }[];
  destinationAccounts: { id: string; name: string; currency: string }[];
  activities: number;
  newActivities: number;
  duplicates: number;
  cashEvents: number;
  replacement?: {
    accountsToDelete: number;
    activitiesToDelete: number;
    cashEventsToDelete: number;
  };
  errors: string[];
  warnings: string[];
}

@Component({
  selector: 'gf-portfolio-restore-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatSelectModule
  ],
  template: `
    <h2 mat-dialog-title>
      @if (isReplace) {
        <ng-container i18n>Replace Data</ng-container>
      } @else {
        <ng-container i18n>Import Data</ng-container>
      }
    </h2>
    <mat-dialog-content>
      @if (isReplace) {
        <p class="text-danger" i18n>
          This operation permanently replaces your existing portfolio accounts,
          activities and cash movements with the selected JSON backup. It cannot
          be undone.
        </p>
        <p i18n>
          Your personal settings, login credentials, watchlist, configured
          benchmarks, and historical manual asset profiles and prices are
          preserved. Export your current data before proceeding.
        </p>
      } @else {
        <p i18n>
          Restore a JSON file created with Export Data. Accounts, financial
          activities and account cash are restored together. Your login
          credentials are not imported.
        </p>
        <p i18n>
          For CSV files, use Import Activities or Import CSV in the account's
          Cash Balances.
        </p>
      }
      <input
        accept=".json,application/json"
        aria-label="Select a Ghostfolio JSON backup"
        type="file"
        [disabled]="busy()"
        (change)="readFile($event)"
      />
      @if (backup(); as data) {
        <p class="mt-3">{{ fileName() }}</p>
        @if (isReplace) {
          <p i18n>
            Every account in the backup will be created as a new account.
            Existing accounts cannot be retained or matched.
          </p>
        } @else {
          <p i18n>
            Choose a destination for each source account. Accounts are never
            matched automatically by name.
          </p>
          @for (account of data.accounts ?? []; track account.id) {
            <mat-form-field
              appearance="outline"
              class="w-100"
              floatLabel="always"
            >
              <mat-label
                >{{ account.name }} ·
                {{ account.currency || unspecifiedCurrency }}</mat-label
              >
              <mat-select
                [disabled]="busy()"
                [ngModel]="choices[account.id!]"
                (ngModelChange)="choose(account.id!, $event)"
              >
                <mat-option i18n value="NEW">Create a new account</mat-option>
                <mat-option i18n value="SKIP">Exclude this account</mat-option>
                @for (target of destinations(); track target.id) {
                  <mat-option [value]="target.id"
                    >{{ target.name }} ·
                    {{ target.currency || unspecifiedCurrency }}</mat-option
                  >
                }
              </mat-select>
            </mat-form-field>
          }
          <mat-checkbox
            i18n
            [disabled]="busy()"
            [ngModel]="restoreSettings"
            (ngModelChange)="restoreSettings = $event; preview.set(null)"
            >Restore base currency and performance method when the destination
            portfolio is empty</mat-checkbox
          >
          <p class="small" i18n>
            Existing data is retained. Restore cash into a new or empty account,
            or an account whose activities match the backup and has no cash
            ledger. Transfers require both accounts. Nothing is saved during
            preview.
          </p>
        }
        <button mat-stroked-button [disabled]="busy()" (click)="loadPreview()">
          @if (isReplace) {
            <ng-container i18n>Preview replacement</ng-container>
          } @else {
            <ng-container i18n>Preview import</ng-container>
          }
        </button>
      }
      @if (error()) {
        <p class="text-danger mt-3" role="alert">{{ error() }}</p>
      }
      @if (preview(); as plan) {
        <section aria-live="polite" class="mt-3">
          <h3>
            @if (isReplace) {
              <ng-container i18n>Replacement summary</ng-container>
            } @else {
              <ng-container i18n>Import summary</ng-container>
            }
          </h3>
          @if (isReplace && plan.replacement; as replacement) {
            <p class="text-danger" i18n>
              Existing data to delete:
              {{ replacement.accountsToDelete }} accounts,
              {{ replacement.activitiesToDelete }} activities and
              {{ replacement.cashEventsToDelete }} cash movements.
            </p>
            <p i18n>
              Data to import: {{ plan.accounts.length }} accounts,
              {{ plan.newActivities }} activities and {{ plan.cashEvents }}
              cash movements.
            </p>
          }
          @for (account of plan.accounts; track account.sourceId) {
            <p>
              {{ account.name }} ·
              {{ account.currency || unspecifiedCurrency }} —
              @if (account.action === 'NEW') {
                <span i18n>New account</span>
              } @else {
                <span i18n>Existing account</span>
              }
            </p>
          }
          @for (account of plan.accounts; track account.sourceId) {
            @if (account.cashBalance !== null) {
              <p>
                {{ account.name }} — <span i18n>Cash balance:</span>
                {{ account.cashBalance }}
                {{ account.currency || unspecifiedCurrency }}
              </p>
            }
          }
          @if (!isReplace) {
            <p>
              <span i18n>New activities:</span> {{ plan.newActivities }} ·
              <span i18n>Already present:</span> {{ plan.duplicates }} ·
              <span i18n>Cash movements:</span> {{ plan.cashEvents }}
            </p>
          }
          @for (warning of plan.warnings; track warning) {
            <p class="text-body-secondary">{{ warning }}</p>
          }
          @for (message of plan.errors; track message) {
            <p class="text-danger" role="alert">{{ message }}</p>
          }
          @if (isReplace) {
            <p i18n>
              The replacement is performed as one transaction. If an error
              occurs, the existing portfolio is preserved.
            </p>
            @if (plan.replacement && !plan.errors.length) {
              <mat-checkbox
                [disabled]="busy()"
                [ngModel]="replaceConfirmed()"
                (ngModelChange)="replaceConfirmed.set($event)"
              >
                <span i18n>
                  I understand that my existing portfolio data will be
                  permanently replaced.
                </span>
              </mat-checkbox>
            }
          } @else {
            <p i18n>
              Confirm only after checking the selected accounts. All accepted
              data is saved together; an error cancels the whole restore.
            </p>
          }
        </section>
      }
      @if (busy()) {
        <p i18n role="status">Processing data…</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button i18n mat-button [disabled]="busy()" (click)="close()">
        Cancel
      </button>
      <button
        mat-flat-button
        [disabled]="
          busy() ||
          !preview() ||
          !!preview()?.errors?.length ||
          (isReplace && (!preview()?.replacement || !replaceConfirmed()))
        "
        (click)="restore()"
      >
        @if (isReplace) {
          <ng-container i18n>Replace Data</ng-container>
        } @else {
          <ng-container i18n>Import Data</ng-container>
        }
      </button>
    </mat-dialog-actions>
  `
})
export class GfPortfolioRestoreDialogComponent {
  protected readonly backup = signal<Backup | null>(null);
  protected readonly preview = signal<RestorePreview | null>(null);
  protected readonly destinations = signal<
    RestorePreview['destinationAccounts']
  >([]);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly fileName = signal('');
  protected choices: Record<string, string> = {};
  protected restoreSettings = true;
  protected readonly unspecifiedCurrency = $localize`Currency not set`;
  private readonly initial = inject<{
    backup?: Backup;
    fileName?: string;
    mode?: 'IMPORT' | 'REPLACE';
  }>(MAT_DIALOG_DATA, { optional: true });
  protected readonly isReplace = this.initial?.mode === 'REPLACE';
  protected readonly replaceConfirmed = signal(false);

  private readonly http = inject(HttpClient);
  private readonly dialog = inject(
    MatDialogRef<GfPortfolioRestoreDialogComponent>
  );
  private readonly user = inject(UserService);

  public ngOnInit() {
    if (this.initial?.backup) {
      this.backup.set(this.initial.backup);
      this.fileName.set(this.initial.fileName ?? '');
      for (const account of this.initial.backup.accounts ?? [])
        if (account.id) this.choices[account.id] = 'NEW';
      void this.loadPreview();
    }
  }

  protected choose(id: string, targetId: string) {
    this.choices[id] = targetId;
    this.preview.set(null);
    this.replaceConfirmed.set(false);
  }
  protected close() {
    this.dialog.close();
  }
  protected async readFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.error.set('');
    this.preview.set(null);
    this.replaceConfirmed.set(false);
    this.backup.set(null);
    this.choices = {};
    try {
      if (file.size > 10 * 1024 * 1024)
        throw new Error($localize`The JSON backup must not exceed 10 MB.`);
      const data = JSON.parse(
        (await file.text()).replace(/^\uFEFF/, '')
      ) as Backup;
      if (
        !Array.isArray(data.activities) ||
        (data.accounts !== undefined && !Array.isArray(data.accounts))
      )
        throw new Error($localize`Choose a Ghostfolio Export Data JSON file.`);
      this.backup.set(data);
      this.fileName.set(file.name);
      for (const account of data.accounts ?? [])
        if (account.id) this.choices[account.id] = 'NEW';
      await this.loadPreview();
    } catch (error) {
      this.showError(error);
    }
  }
  protected async loadPreview() {
    this.busy.set(true);
    this.error.set('');
    this.preview.set(null);
    this.replaceConfirmed.set(false);
    try {
      const result = await firstValueFrom(
        this.http.post<RestorePreview>(
          this.isReplace
            ? '/api/v1/import/restore/replace/preview'
            : '/api/v1/import/restore/preview',
          this.payload()
        )
      );
      this.destinations.set(result.destinationAccounts);
      this.preview.set(result);
    } catch (error) {
      this.showError(error);
    } finally {
      this.busy.set(false);
    }
  }
  protected async restore() {
    const plan = this.preview();
    if (
      !plan ||
      plan.errors.length ||
      this.busy() ||
      (this.isReplace && (!plan.replacement || !this.replaceConfirmed()))
    )
      return;
    this.busy.set(true);
    this.error.set('');
    try {
      await firstValueFrom(
        this.http.post(
          this.isReplace
            ? '/api/v1/import/restore/replace'
            : '/api/v1/import/restore',
          {
            ...this.payload(),
            digest: plan.digest
          }
        )
      );
      // The financial write already committed. A refresh failure must not
      // turn it into a retryable import failure.
      await firstValueFrom(this.user.get(true)).catch(() => undefined);
      this.dialog.close(true);
    } catch (error) {
      this.preview.set(null);
      this.replaceConfirmed.set(false);
      this.showError(error);
    } finally {
      this.busy.set(false);
    }
  }
  private payload() {
    return {
      backup: this.backup(),
      choices: Object.entries(this.choices).map(([sourceId, targetId]) => ({
        sourceId,
        targetId
      })),
      restoreSettings: this.isReplace ? false : this.restoreSettings
    };
  }

  private showError(error: unknown) {
    const message =
      error instanceof HttpErrorResponse
        ? error.error?.message
        : error instanceof Error
          ? error.message
          : $localize`Import failed. Preview the file again.`;
    this.error.set(
      Array.isArray(message) ? message.join(' ') : String(message)
    );
  }
}
