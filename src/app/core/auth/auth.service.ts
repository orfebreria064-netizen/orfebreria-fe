import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Session } from '@supabase/supabase-js';
import { SupabaseService } from '../services/supabase.service';
import { LookupService } from '../services/lookup.service';
import { Profile } from '../models/profile.model';
import { AppRole } from '../models/domain';
import { AppError, unwrap } from '../../shared/utils/db';

const AUTH_MESSAGES: Record<string, string> = {
  'Invalid login credentials': 'Correo o contraseña incorrectos.',
  'Email not confirmed': 'Debe confirmar su correo electrónico antes de ingresar.',
  'User already registered': 'Ya existe una cuenta con ese correo.',
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
        this.profile.set(null);
        this.lookups.reset();
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
      this.profile.set(null);
      return null;
    }
    const profile = unwrap(await this.supabase.from('profiles').select('*').eq('id', userId).maybeSingle()) as Profile | null;
    this.profile.set(profile);
    return profile;
  }

  async signIn(email: string, password: string): Promise<Profile | null> {
    const { data, error } = await this.supabase.auth.signInWithPassword({ email, password });
    if (error) throw new AppError(AUTH_MESSAGES[error.message] ?? error.message);
    this.session.set(data.session);
    return this.loadProfile();
  }

  /** Devuelve true si la cuenta quedó con sesión iniciada (sin confirmación de email pendiente). */
  async signUp(fullName: string, email: string, password: string): Promise<boolean> {
    const { data, error } = await this.supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (error) throw new AppError(AUTH_MESSAGES[error.message] ?? error.message);
    this.session.set(data.session);
    if (data.session) await this.loadProfile();
    return data.session !== null;
  }

  async signOut(): Promise<void> {
    await this.supabase.auth.signOut();
    this.session.set(null);
    this.profile.set(null);
    this.lookups.reset();
    await this.router.navigate(['/login']);
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
