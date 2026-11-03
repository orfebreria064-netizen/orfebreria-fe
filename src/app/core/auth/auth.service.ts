import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Session } from '@supabase/supabase-js';
import { SupabaseService } from '../services/supabase.service';
import { LookupService } from '../services/lookup.service';
import { Profile } from '../models/profile.model';
import { AppRole } from '../models/domain';
import { AppError, unwrap } from '../../shared/utils/db';
import { isPwnedPassword } from '../../shared/utils/pwned';

const AUTH_MESSAGES: Record<string, string> = {
  'Invalid login credentials': 'Correo o contraseña incorrectos.',
  'Email not confirmed': 'Debe confirmar su correo electrónico antes de ingresar.',
  'User already registered': 'Ya existe una cuenta con ese correo.',
  'New password should be different from the old password.': 'La nueva contraseña debe ser distinta de la anterior.',
  'email rate limit exceeded': 'Se alcanzó el límite de correos por hora. Intente nuevamente en unos minutos.',
  'For security purposes, you can only request this after 60 seconds.': 'Por seguridad, espere un minuto antes de solicitar otro enlace.',
};

/** Sesión y perfil del usuario actual (signals). */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabase = inject(SupabaseService).client;
  private readonly router = inject(Router);
  private readonly lookups = inject(LookupService);

  readonly session = signal<Session | null>(null);
  readonly profile = signal<Profile | null>(null);

  readonly isAuthenticated = computed(() => this.session() !== null);
  readonly isActive = computed(() => this.profile()?.active === true);
  readonly role = computed<AppRole | null>(() => (this.profile()?.active ? this.profile()!.role : null));
  readonly userName = computed(() => this.profile()?.full_name ?? this.session()?.user.email ?? '');

  /** Se ejecuta antes del arranque (provideAppInitializer). */
  async init(): Promise<void> {
    const { data } = await this.supabase.auth.getSession();
    this.session.set(data.session);
    if (data.session) await this.loadProfile();

    this.supabase.auth.onAuthStateChange((event, session) => {
      this.session.set(session);
      if (event === 'SIGNED_OUT') {
        this.clearUser();
        void this.router.navigate(['/login']);
      } else if (event === 'SIGNED_IN' && session && this.profile()?.id !== session.user.id) {
        // Fuera del callback para no bloquear el lock interno de supabase-js
        setTimeout(() => void this.loadProfile());
      }
    });
  }

  async loadProfile(): Promise<Profile | null> {
    const userId = this.session()?.user.id;
    if (!userId) {
      this.clearUser();
      return null;
    }
    const p = unwrap(await this.supabase.from('profiles').select('*').eq('id', userId).maybeSingle()) as Profile | null;
    this.profile.set(p);
    return p;
  }

  async signIn(email: string, password: string): Promise<Profile | null> {
    const { data, error } = await this.supabase.auth.signInWithPassword({ email, password });
    if (error) throw new AppError(AUTH_MESSAGES[error.message] ?? error.message);
    this.session.set(data.session);
    return this.loadProfile();
  }

  /** Envía el enlace para crear una nueva contraseña (también sirve para reenviar el acceso a un invitado). */
  async requestPasswordReset(email: string): Promise<void> {
    const { error } = await this.supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/activar-cuenta`,
    });
    if (error) throw new AppError(AUTH_MESSAGES[error.message] ?? error.message);
  }

  /**
   * Valida el token de un enlace de invitación o recuperación (formato ?token_hash=…&type=…).
   * Se llama solo cuando la persona pulsa «Continuar»: así los revisores automáticos de enlaces
   * (antivirus del correo, vista previa de WhatsApp) no gastan el token de un solo uso.
   */
  async verifyEmailLink(tokenHash: string, type: 'invite' | 'recovery'): Promise<void> {
    const { data, error } = await this.supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) throw new AppError('El enlace venció o ya fue utilizado. Solicite uno nuevo.');
    this.session.set(data.session);
    await this.loadProfile();
  }

  /** Define la contraseña del usuario con sesión (invitación o recuperación). */
  async updatePassword(password: string): Promise<void> {
    if (await isPwnedPassword(password)) {
      throw new AppError('Esta contraseña aparece en filtraciones de datos conocidas. Elija otra.');
    }
    const { error } = await this.supabase.auth.updateUser({ password });
    if (error) throw new AppError(AUTH_MESSAGES[error.message] ?? error.message);
  }

  /** Cambio de contraseña con sesión iniciada: se verifica la contraseña actual antes de reemplazarla. */
  async changePassword(current: string, next: string): Promise<void> {
    const email = this.session()?.user.email;
    if (!email) throw new AppError('Su sesión expiró. Vuelva a ingresar.');
    const { error: checkError } = await this.supabase.auth.signInWithPassword({ email, password: current });
    if (checkError) throw new AppError('La contraseña actual no es correcta.');
    await this.updatePassword(next);
  }

  async signOut(): Promise<void> {
    await this.supabase.auth.signOut();
    this.session.set(null);
    this.clearUser();
    await this.router.navigate(['/login']);
  }

  private clearUser(): void {
    this.profile.set(null);
    this.lookups.reset();
  }

  hasRole(...roles: AppRole[]): boolean {
    const role = this.role();
    return role !== null && roles.includes(role);
  }

  /** Página inicial según rol. */
  homeUrl(): string {
    switch (this.role()) {
      case 'ADMIN':
      case 'GERENTE':
        return '/dashboard';
      case 'ORFEBRE':
      case 'SUPERVISOR':
        return '/production';
      default:
        return '/orders';
    }
  }
}
