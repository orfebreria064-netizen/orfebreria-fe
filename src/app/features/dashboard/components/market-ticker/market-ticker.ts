import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MarketService, MarketToday, RATE_SOURCE_LABELS } from '../../../../core/services/market.service';
import { MoneyPipe } from '../../../../shared/pipes/money.pipe';

/**
 * Indicadores del día en la cabecera del dashboard: precio del oro (el de la empresa y el
 * internacional) y tipo de cambio paralelo. Si no hay dato de hoy se marca como desactualizado.
 */
@Component({
  selector: 'app-market-ticker',
  imports: [DatePipe, DecimalPipe, RouterLink, MoneyPipe],
  template: `
    @if (data(); as m) {
      <div class="ticker">
        <a class="chip" routerLink="/materials" [queryParams]="{ tab: 'prices' }" [class.chip--stale]="goldStale()" [title]="goldTitle()">
          <i class="pi pi-sun chip__icon chip__icon--gold"></i>
          <span class="chip__body">
            <small>Oro hoy{{ goldStale() ? ' · desactualizado' : '' }}</small>
            @if (m.company_gold[0]; as g) {
              <strong>{{ g.purity ?? g.name }}: {{ g.price | money: 'USD' }}/{{ g.unit }}</strong>
            } @else if (m.gold?.pen_g_24k) {
              <strong>24K: {{ m.gold!.pen_g_24k | money }}/g</strong>
            } @else {
              <strong class="muted">Sin precio</strong>
            }
            @if (m.gold) {
              <small class="mono">US$ {{ m.gold.usd_oz | number: '1.2-2' }}/oz · 18K int. {{ (m.gold.pen_g_24k ?? 0) * 0.75 | money }}/g</small>
            }
          </span>
        </a>
        <a class="chip" routerLink="/tipo-cambio" [class.chip--stale]="rateStale()" [title]="rateTitle()">
          <i class="pi pi-dollar chip__icon chip__icon--green"></i>
          <span class="chip__body">
            <small>TC hoy{{ rateStale() ? ' · ' + (m.exchange ? (m.exchange.rate_date | date: 'dd/MM') : 'sin registro') : '' }}</small>
            @if (m.exchange; as e) {
              <strong class="mono">C {{ e.buy | number: '1.3-3' }} · V {{ e.sell | number: '1.3-3' }}</strong>
            } @else {
              <strong class="muted">Sin registro</strong>
            }
            @if (m.sunat) {
              <small class="mono">SUNAT {{ m.sunat.buy | number: '1.3-3' }} / {{ m.sunat.sell | number: '1.3-3' }}</small>
            }
          </span>
        </a>
      </div>
    }
  `,
  styles: `
    .ticker {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .chip {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      padding: 0.35rem 0.75rem 0.35rem 0.55rem;
      border: 1px solid var(--p-surface-200);
      border-radius: 0.6rem;
      background: var(--p-surface-0);
      color: inherit;
      text-decoration: none;
      line-height: 1.2;
    }
    .chip:hover {
      border-color: var(--p-primary-400);
    }
    .chip--stale {
      border-style: dashed;
      border-color: var(--p-orange-400);
    }
    .chip__icon {
      display: grid;
      place-items: center;
      width: 1.9rem;
      height: 1.9rem;
      border-radius: 50%;
      font-size: 0.95rem;
    }
    .chip__icon--gold {
      background: #fbf1d3;
      color: #9a6b00;
    }
    .chip__icon--green {
      background: #dcf3e8;
      color: #157a54;
    }
    .chip__body {
      display: flex;
      flex-direction: column;
    }
    .chip__body small {
      font-size: 0.7rem;
      color: var(--p-surface-500);
    }
    .chip__body strong {
      font-size: 0.88rem;
      white-space: nowrap;
    }
    @media (max-width: 640px) {
      .ticker,
      .chip {
        flex: 1 1 100%;
      }
    }
  `,
})
export class MarketTicker implements OnInit {
  private readonly service = inject(MarketService);
  protected readonly data = signal<MarketToday | null>(null);

  protected readonly goldStale = computed(() => {
    const m = this.data();
    if (!m) return false;
    const g = m.company_gold[0];
    return g ? g.price_date !== m.date : m.gold?.price_date !== m.date;
  });
  protected readonly rateStale = computed(() => {
    const m = this.data();
    return !!m && m.exchange?.rate_date !== m.date;
  });

  protected goldTitle(): string {
    const m = this.data();
    const g = m?.company_gold[0];
    const own = g ? `Precio de venta de la empresa (${g.name}), registrado el ${g.price_date}.` : 'La empresa no registró precio del oro.';
    const intl = m?.gold ? ` Internacional: US$ ${m.gold.usd_oz}/oz (${m.gold.price_date}).` : '';
    return own + intl;
  }

  protected rateTitle(): string {
    const e = this.data()?.exchange;
    return e ? `${RATE_SOURCE_LABELS[e.source]} · ${e.rate_date}` : 'Aún no hay tipo de cambio registrado.';
  }

  async ngOnInit(): Promise<void> {
    try {
      this.data.set(await this.service.today());
    } catch {
      // Indicador secundario: si falla no se interrumpe el dashboard.
    }
  }
}
