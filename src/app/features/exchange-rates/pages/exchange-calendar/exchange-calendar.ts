import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { TagModule } from 'primeng/tag';
import { AuthService } from '../../../../core/auth/auth.service';
import { MODULE_ROLES } from '../../../../core/auth/roles';
import { NotifyService } from '../../../../core/services/notify.service';
import { ExchangeRate, MarketService, RATE_SOURCE_LABELS } from '../../../../core/services/market.service';
import { PageHeader } from '../../../../shared/components/page-header/page-header';
import { fromIsoDate, toIsoDate, todayIso } from '../../../../shared/utils/db';

const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

interface DayCell {
  iso: string;
  day: number;
  future: boolean;
  today: boolean;
  /** Registro del día (el de la empresa gana al automático). */
  rate: ExchangeRate | null;
  /** Sin registro del día: rige el último anterior. */
  carried: ExchangeRate | null;
  auto: ExchangeRate | null;
}

/**
 * Tipo de cambio en calendario: el paralelo se registra solo varias veces al día (Kambista, con
 * SUNAT de respaldo); ADMIN y GERENTE pueden corregir el de un día para su empresa.
 */
@Component({
  selector: 'app-exchange-calendar',
  imports: [DatePipe, DecimalPipe, FormsModule, ButtonModule, DialogModule, InputNumberModule, TagModule, PageHeader],
  template: `
    <app-page-header title="Tipo de cambio" subtitle="Dólar paralelo registrado automáticamente cada día (compra / venta)">
      @if (canWrite) {
        <p-button label="Actualizar ahora" icon="pi pi-refresh" severity="secondary" [outlined]="true" [loading]="refreshing()" (onClick)="refresh()" />
      }
    </app-page-header>

    <section class="card">
      <div class="cal-head">
        <p-button icon="pi pi-chevron-left" [text]="true" severity="secondary" ariaLabel="Mes anterior" (onClick)="move(-1)" />
        <h2>{{ monthLabel() }}</h2>
        <p-button icon="pi pi-chevron-right" [text]="true" severity="secondary" ariaLabel="Mes siguiente" [disabled]="isCurrentMonth()" (onClick)="move(1)" />
        <p-button label="Hoy" [text]="true" size="small" [disabled]="isCurrentMonth()" (onClick)="goToday()" />
        <span class="legend muted small">
          <span><i class="dot dot--auto"></i> Automático</span>
          <span><i class="dot dot--manual"></i> Corregido por la empresa</span>
          <span><i class="dot dot--carried"></i> Sin registro (rige el anterior)</span>
        </span>
      </div>

      <div class="cal" [class.cal--loading]="loading()">
        @for (w of weekdays; track w) {
          <div class="cal__wd">{{ w }}</div>
        }
        @for (c of cells(); track $index) {
          @if (!c) {
            <div class="cal__day cal__day--empty"></div>
          } @else {
            <button
              type="button"
              class="cal__day"
              [class.cal__day--today]="c.today"
              [class.cal__day--future]="c.future"
              [class.cal__day--manual]="c.rate?.source === 'MANUAL'"
              [class.cal__day--carried]="!c.rate && c.carried"
              [disabled]="c.future || !canWrite"
              [attr.aria-label]="dayAria(c)"
              (click)="open(c)"
            >
              <span class="cal__num">{{ c.day }}</span>
              @if (c.rate ?? c.carried; as r) {
                <span class="cal__rate"><small>C</small> {{ r.buy | number: '1.3-3' }}</span>
                <span class="cal__rate"><small>V</small> {{ r.sell | number: '1.3-3' }}</span>
              } @else if (!c.future) {
                <span class="muted small">—</span>
              }
            </button>
          }
        }
      </div>
    </section>

    <p-dialog [header]="'Tipo de cambio del ' + (editing()?.iso | date: 'dd/MM/yyyy')" [(visible)]="dialogVisible" [modal]="true" [style]="{ width: '420px' }" [draggable]="false">
      @if (editing(); as c) {
        @if (c.auto) {
          <p class="small muted" style="margin-top: 0">
            {{ sourceLabels[c.auto.source] }}: compra {{ c.auto.buy | number: '1.3-3' }} · venta {{ c.auto.sell | number: '1.3-3' }}
            @if (c.auto.sunat_sell) {
              <br />Oficial SUNAT: compra {{ c.auto.sunat_buy | number: '1.3-3' }} · venta {{ c.auto.sunat_sell | number: '1.3-3' }}
            }
          </p>
        }
        <div class="form-grid">
          <div class="field">
            <label for="tc-buy">Compra</label>
            <p-inputnumber inputId="tc-buy" [(ngModel)]="buy" [minFractionDigits]="3" [maxFractionDigits]="4" [min]="0" [fluid]="true" />
          </div>
          <div class="field">
            <label for="tc-sell">Venta</label>
            <p-inputnumber inputId="tc-sell" [(ngModel)]="sell" [minFractionDigits]="3" [maxFractionDigits]="4" [min]="0" [fluid]="true" />
          </div>
        </div>
        <p class="small muted">El valor registrado aquí reemplaza al automático de ese día solo para su empresa.</p>
      }
      <ng-template #footer>
        @if (editing()?.rate?.source === 'MANUAL') {
          <p-button label="Volver al automático" severity="danger" [text]="true" [loading]="saving()" (onClick)="removeManual()" />
        }
        <p-button label="Cancelar" severity="secondary" [text]="true" (onClick)="dialogVisible = false" />
        <p-button label="Guardar" icon="pi pi-check" [loading]="saving()" [disabled]="!buy || !sell" (onClick)="save()" />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .cal-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.25rem;
      margin-bottom: 0.75rem;
    }
    .cal-head h2 {
      margin: 0 0.25rem;
      font-size: 1.1rem;
      font-weight: 650;
      min-width: 10rem;
      text-align: center;
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 0.9rem;
      margin-left: auto;
    }
    .dot {
      display: inline-block;
      width: 0.6rem;
      height: 0.6rem;
      border-radius: 50%;
      margin-right: 0.25rem;
      vertical-align: middle;
    }
    .dot--auto {
      background: var(--p-surface-300);
    }
    .dot--manual {
      background: var(--p-primary-500);
    }
    .dot--carried {
      border: 1px dashed var(--p-surface-400);
    }
    .cal {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 0.4rem;
    }
    .cal--loading {
      opacity: 0.55;
    }
    .cal__wd {
      text-align: center;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--p-surface-500);
      text-transform: uppercase;
    }
    .cal__day {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.1rem;
      min-height: 5.2rem;
      padding: 0.45rem 0.55rem;
      border: 1px solid var(--p-surface-200);
      border-radius: 0.5rem;
      background: var(--p-surface-0);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .cal__day:disabled {
      cursor: default;
    }
    .cal__day:not(:disabled):hover {
      border-color: var(--p-primary-400);
    }
    .cal__day--empty {
      border: 0;
      background: transparent;
    }
    .cal__day--future {
      background: var(--p-surface-50);
    }
    .cal__day--today {
      outline: 2px solid var(--p-primary-500);
      outline-offset: -1px;
    }
    .cal__day--manual {
      border-left: 4px solid var(--p-primary-500);
    }
    .cal__day--carried {
      border-style: dashed;
      color: var(--p-surface-500);
    }
    .cal__num {
      font-weight: 650;
      font-size: 0.85rem;
    }
    .cal__rate {
      font-family: var(--app-mono, ui-monospace, monospace);
      font-size: 0.82rem;
      white-space: nowrap;
    }
    .cal__rate small {
      color: var(--p-surface-500);
    }
    @media (max-width: 720px) {
      .cal {
        gap: 0.2rem;
      }
      .cal__day {
        min-height: 4rem;
        padding: 0.3rem;
      }
      .cal__rate {
        font-size: 0.68rem;
      }
      .cal__rate small {
        display: none;
      }
    }
  `,
})
export class ExchangeCalendar implements OnInit {
  private readonly service = inject(MarketService);
  private readonly notify = inject(NotifyService);
  private readonly auth = inject(AuthService);

  protected readonly canWrite = this.auth.hasRole(...MODULE_ROLES.exchangeRatesWrite);
  protected readonly weekdays = WEEKDAYS;
  protected readonly sourceLabels = RATE_SOURCE_LABELS;

  private readonly today = todayIso();
  /** Primer día del mes mostrado. */
  protected readonly month = signal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  private readonly auto = signal<ExchangeRate[]>([]);
  private readonly manual = signal<ExchangeRate[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly refreshing = signal(false);

  protected dialogVisible = false;
  protected readonly editing = signal<DayCell | null>(null);
  protected buy: number | null = null;
  protected sell: number | null = null;

  protected readonly monthLabel = computed(() => `${MONTH_NAMES[this.month().getMonth()]} ${this.month().getFullYear()}`);
  protected readonly isCurrentMonth = computed(() => toIsoDate(this.month())!.slice(0, 7) === this.today.slice(0, 7));

  /** Celdas del mes (lunes a domingo); null = hueco antes del día 1. */
  protected readonly cells = computed<(DayCell | null)[]>(() => {
    const first = this.month();
    const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const auto = new Map(this.auto().map((r) => [r.rate_date, r]));
    const manual = new Map(this.manual().map((r) => [r.rate_date, r]));
    const sortedAuto = [...this.auto()].sort((a, b) => a.rate_date.localeCompare(b.rate_date));
    const out: (DayCell | null)[] = Array.from({ length: (first.getDay() + 6) % 7 }, () => null);
    let last: ExchangeRate | null = null;
    for (let d = 1; d <= days; d++) {
      const iso = toIsoDate(new Date(first.getFullYear(), first.getMonth(), d))!;
      while (sortedAuto.length && sortedAuto[0].rate_date < iso) last = sortedAuto.shift()!;
      const rate = manual.get(iso) ?? auto.get(iso) ?? null;
      const future = iso > this.today;
      out.push({ iso, day: d, future, today: iso === this.today, rate, carried: rate || future ? null : last, auto: auto.get(iso) ?? null });
      if (rate) last = rate;
    }
    return out;
  });

  ngOnInit(): void {
    void this.load();
  }

  protected move(delta: number): void {
    const m = this.month();
    this.month.set(new Date(m.getFullYear(), m.getMonth() + delta, 1));
    void this.load();
  }

  protected goToday(): void {
    this.month.set(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    void this.load();
  }

  protected async load(): Promise<void> {
    const first = this.month();
    const from = toIsoDate(first)!;
    const to = toIsoDate(new Date(first.getFullYear(), first.getMonth() + 1, 0))!;
    this.loading.set(true);
    try {
      const { auto, manual } = await this.service.rates(from, to);
      this.auto.set(auto);
      this.manual.set(manual);
    } catch (err) {
      this.notify.error(err, 'No se pudo cargar el tipo de cambio.');
    } finally {
      this.loading.set(false);
    }
  }

  protected dayAria(c: DayCell): string {
    const r = c.rate ?? c.carried;
    const date = fromIsoDate(c.iso)!.toLocaleDateString('es-PE');
    return r ? `${date}: compra ${r.buy}, venta ${r.sell}` : date;
  }

  protected open(c: DayCell): void {
    const r = c.rate ?? c.carried;
    this.editing.set(c);
    this.buy = r ? Number(r.buy) : null;
    this.sell = r ? Number(r.sell) : null;
    this.dialogVisible = true;
  }

  protected async save(): Promise<void> {
    const c = this.editing();
    if (!c || !this.buy || !this.sell) return;
    this.saving.set(true);
    try {
      await this.service.save(c.iso, this.buy, this.sell);
      this.notify.success('Tipo de cambio registrado.');
      this.dialogVisible = false;
      await this.load();
    } catch (err) {
      this.notify.error(err, 'No se pudo guardar el tipo de cambio.');
    } finally {
      this.saving.set(false);
    }
  }

  protected async removeManual(): Promise<void> {
    const c = this.editing();
    if (!c) return;
    this.saving.set(true);
    try {
      await this.service.remove(c.iso);
      this.notify.success('Se usará el tipo de cambio automático de ese día.');
      this.dialogVisible = false;
      await this.load();
    } catch (err) {
      this.notify.error(err, 'No se pudo quitar el registro.');
    } finally {
      this.saving.set(false);
    }
  }

  protected async refresh(): Promise<void> {
    this.refreshing.set(true);
    try {
      const res = await this.service.refresh();
      if (res.errors?.length) this.notify.warn(`Algunas fuentes no respondieron: ${res.errors.join('; ')}`);
      else this.notify.success('Tipo de cambio y precio del oro actualizados.');
      await this.load();
    } catch (err) {
      this.notify.error(err, 'No se pudo actualizar.');
    } finally {
      this.refreshing.set(false);
    }
  }
}
