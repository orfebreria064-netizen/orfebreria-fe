import { Component, computed, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { SHOW_PLAN_TAB } from '../../core/config/platform';
import { fromIsoDate } from '../../shared/utils/db';

type Tone = 'info' | 'warn' | 'danger';

/**
 * Aviso del estado del plan: prueba o plan por vencer (≤ 7 días), periodo de gracia y solo lectura.
 * Icono + texto: el color nunca va solo.
 */
@Component({
  selector: 'app-subscription-banner',
  imports: [DatePipe, RouterLink],
  template: `
    @if (notice(); as n) {
      <div class="banner" [class]="'banner banner--' + n.tone" role="status">
        <i [class]="n.icon" aria-hidden="true"></i>
        <span class="banner__text">
          <strong>{{ n.title }}</strong>
          @if (n.date) {
            {{ n.detail }} {{ n.date | date: "d 'de' MMMM" }}.
          } @else {
            {{ n.detail }}
          }
        </span>
        @if (auth.hasRole('ADMIN')) {
          @if (showPlanTab) {
            <a routerLink="/settings" [queryParams]="{ tab: 'plan' }">{{ n.tone === 'info' ? 'Ver planes' : 'Renovar' }}</a>
          }
        } @else {
          <span class="banner__hint">Avise al administrador de su empresa.</span>
        }
      </div>
    }
  `,
  styles: `
    .banner {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.35rem 0.75rem;
      margin-bottom: var(--app-gap);
      padding: 0.65rem 1rem;
      border: 1px solid;
      border-radius: var(--app-radius);
      font-size: 0.875rem;
    }
    .banner i {
      font-size: 1rem;
    }
    .banner__text {
      flex: 1;
      min-width: 220px;
    }
    .banner a {
      font-weight: 600;
      white-space: nowrap;
    }
    .banner__hint {
      font-size: 0.8rem;
      opacity: 0.85;
    }
    .banner--info {
      background: var(--p-sky-50);
      border-color: var(--p-sky-200);
      color: var(--p-sky-900);
    }
    .banner--warn {
      background: var(--p-amber-50);
      border-color: var(--p-amber-200);
      color: var(--p-amber-900);
    }
    .banner--danger {
      background: var(--p-red-50);
      border-color: var(--p-red-200);
      color: var(--p-red-900);
    }
    .banner a {
      color: inherit;
    }
  `,
})
export class SubscriptionBanner {
  protected readonly auth = inject(AuthService);
  protected readonly showPlanTab = SHOW_PLAN_TAB;

  protected readonly notice = computed<{ tone: Tone; icon: string; title: string; detail: string; date?: Date | null } | null>(() => {
    const s = this.auth.subscription();
    if (!s) return null;
    const days = s.days_left;
    const inDays = days === 0 ? 'hoy' : days === 1 ? 'mañana' : `en ${days} días`;
    switch (s.state) {
      case 'TRIAL':
        return days <= 7
          ? { tone: 'info', icon: 'pi pi-clock', title: `Su prueba gratis termina ${inDays}.`, detail: 'Elija un plan para seguir usando el sistema sin interrupciones.' }
          : null;
      case 'ACTIVE':
        return days <= 7
          ? { tone: 'warn', icon: 'pi pi-calendar-clock', title: `Su plan ${s.plan_name} vence ${inDays}.`, detail: 'Renueve a tiempo para no perder acceso.' }
          : null;
      case 'GRACE':
        return {
          tone: 'warn',
          icon: 'pi pi-exclamation-triangle',
          title: 'Su plan venció.',
          detail: 'Puede seguir trabajando con normalidad hasta el',
          date: fromIsoDate(s.grace_end),
        };
      case 'EXPIRED':
        return {
          tone: 'danger',
          icon: 'pi pi-lock',
          title: 'Plan vencido: modo solo lectura.',
          detail: 'Puede consultar su información, pero no registrar ni modificar datos hasta regularizar el pago.',
        };
      default:
        return null;
    }
  });
}
