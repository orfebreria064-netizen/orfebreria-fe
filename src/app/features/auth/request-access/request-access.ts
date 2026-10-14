import { Component, OnInit, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { MessageModule } from 'primeng/message';
import { SupabaseService } from '../../../core/services/supabase.service';
import { Plan } from '../../../core/models/subscription.model';
import { FieldError } from '../../../shared/components/field-error/field-error';
import { phoneValidator } from '../../../shared/utils/validators';
import { unwrap } from '../../../shared/utils/db';

/**
 * Formulario público de solicitud de acceso para una empresa nueva.
 * La solicitud queda PENDIENTE hasta que el superadministrador la apruebe y envíe la invitación.
 */
@Component({
  selector: 'app-request-access',
  imports: [DecimalPipe, ReactiveFormsModule, RouterLink, ButtonModule, InputTextModule, TextareaModule, MessageModule, FieldError],
  templateUrl: './request-access.html',
  styleUrls: ['../auth-shell.scss', './request-access.scss'],
})
export class RequestAccess implements OnInit {
  private readonly db = inject(SupabaseService).client;

  protected readonly plans = signal<Plan[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly sent = signal(false);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    company_name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(120)]],
    tax_id: ['', [Validators.pattern(/^(10|15|17|20)\d{9}$/)]],
    contact_name: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(120)]],
    email: ['', [Validators.required, Validators.email]],
    phone: ['', [Validators.required, phoneValidator]],
    plan_code: ['TALLER'],
    message: ['', [Validators.maxLength(1000)]],
  });

  async ngOnInit(): Promise<void> {
    try {
      this.plans.set(unwrap(await this.db.from('plans').select('*').eq('active', true).order('position')) as Plan[]);
    } catch {
      // Sin planes visibles el formulario sigue funcionando.
    }
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      const v = this.form.getRawValue();
      unwrap(
        await this.db.rpc('submit_access_request', {
          p_company_name: v.company_name,
          p_tax_id: v.tax_id,
          p_contact_name: v.contact_name,
          p_email: v.email,
          p_phone: v.phone,
          p_plan_code: v.plan_code,
          p_message: v.message,
        }),
      );
      this.sent.set(true);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'No se pudo enviar la solicitud.');
    } finally {
      this.loading.set(false);
    }
  }
}
