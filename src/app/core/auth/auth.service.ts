import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Session } from '@supabase/supabase-js';
import { SupabaseService } from '../services/supabase.service';
import { LookupService } from '../services/lookup.service';
import { Profile } from '../models/profile.model';
import { AppRole } from '../models/domain';
import { MySubscription } from '../models/subscription.model';
import { AppError, unwrap } from '../../shared/utils/db';
import { isPwnedPassword } from '../../shared/utils/pwned';

const AUTH_MESSAGES: Record<string, string> = {
  'Invalid login credentials': 'Correo o contraseña incorrectos.',
  'Email not confirmed': 'Debe confirmar su correo electrónico antes de ingresar.',
  'User already registered': 'Ya existe una cuenta con ese correo.',
  'New password should be different from the old password.': 'La nueva contraseña debe ser distinta de la anterior.',
};

/** Sesión, perfil, plan de la empresa y rol de plataforma del usuario actual (signals). */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabase = inject(SupabaseService).client;
  private readonly router = inject(Router);
  private readonly lookups = inject(LookupService);

  readonly session = signal<Session | null>(null);
  readonly profile = signal<Profile | null>(null);
  readonly subscription = signal<MySubscription | null>(null);
  readonly isPlatformAdmin = signal(false);

  readonly isAuthenticated = computed(() => this.session() !== null);
  /** Superadministrador sin empresa: solo administra la plataforma. */
  readonly isPlatformOnly = computed(() => this.isPlatformAdmin() && this.profile() === null);
  readonly isActive = computed(() => this.isPlatformOnly() || this.profile()?.active === true);
  readonly role = computed<AppRole | null>(() => (this.profile()?.active ? this.profile()!.role : null));
  readonly userName = computed(() => this.profile()?.full_name ?? this.session()?.user.email ?? '');
  /** Suspendida o cancelada por la plataforma: sin acceso a los datos. */
  readonly isBlocked = computed(() => ['SUSPENDED', 'CANCELLED'].includes(this.subscription()?.state ?? ''));
  /** Vencida: solo lectura (lo exige la base de datos). */
  readonly isReadOnly = computed(() => this.subscription()?.state === 'EXPIRED');

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
    const [profile, subscription, platform] = await Promise.all([
      this.supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      this.supabase.rpc('my_subscription'),
      this.supabase.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle(),
    ]);
    this.subscription.set((unwrap(subscription) as MySubscription | null) ?? null);
    this.isPlatformAdmin.set(unwrap(platform) !== null);
    const p = unwrap(profile) as Profile | null;
    this.profile.set(p);
    return p;
  }

  async refreshSubscription(): Promise<void> {
    this.subscription.set((unwrap(await this.supabase.rpc('my_subscription')) as MySubscription | null) ?? null);
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
    this.subscription.set(null);
    this.isPlatformAdmin.set(false);
    this.lookups.reset();
  }

  hasRole(...roles: AppRole[]): boolean {
    const role = this.role();
    return role !== null && roles.includes(role);
  }

  /** Página inicial según rol. */
  homeUrl(): string {
    if (this.isPlatformOnly()) return '/plataforma';
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
