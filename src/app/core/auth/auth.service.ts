import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../services/api.service';
import { LookupService } from '../services/lookup.service';
import { TokenService } from './token.service';
import { Profile } from '../models/profile.model';
import { AppRole } from '../models/domain';
import { MySubscription } from '../models/subscription.model';
import { Branch } from '../models/catalog.model';
import { AppError } from '../../shared/utils/db';

/** Respuesta de Login/validausuario. */
interface RespuestaLogin {
  estado: number;
  mensaje: string | null;
  token: string | null;
}

/** Respuesta de Login/sesion (api.usp_me_get). El superadministrador no tiene empresa: org_id y role en null. */
interface SesionApi {
  perfil:
    | (Omit<Profile, 'org_id' | 'role' | 'created_at' | 'updated_at'> & {
        org_id: string | null;
        role: AppRole | null;
        is_platform_admin: boolean;
        company_name: string | null;
        default_branch_id: string | null;
      })
    | null;
  suscripcion: MySubscription | null;
  sucursales: Branch[];
}

export type ActivationType = 'invitacion' | 'recuperacion';

/** Espera máxima de Login/sesion al arrancar la app. */
const INIT_TIMEOUT_MS = 10_000;

/** Sesión (JWT de la API), perfil, plan de la empresa, sucursales y rol de plataforma del usuario actual (signals). */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);
  private readonly tokens = inject(TokenService);
  private readonly router = inject(Router);
  private readonly lookups = inject(LookupService);

  readonly profile = signal<Profile | null>(null);
  readonly subscription = signal<MySubscription | null>(null);
  readonly branches = signal<Branch[]>([]);
  readonly isPlatformAdmin = signal(false);
  /** Nombre y correo de la cuenta (también para el superadministrador, que no tiene perfil de empresa). */
  private readonly account = signal<{ full_name: string; email: string } | null>(null);

  readonly isAuthenticated = computed(() => this.tokens.token() !== null);
  /** Superadministrador sin empresa: solo ve el panel de Plataforma. */
  readonly isPlatformOnly = computed(() => this.isPlatformAdmin() && this.profile() === null);
  readonly email = computed(() => this.account()?.email ?? null);
  readonly isActive = computed(() => this.isPlatformOnly() || this.profile()?.active === true);
  readonly role = computed<AppRole | null>(() => (this.profile()?.active ? this.profile()!.role : null));
  readonly userName = computed(() => this.account()?.full_name ?? '');
  /** Suspendida o cancelada por la plataforma: sin acceso a los datos. */
  readonly isBlocked = computed(() => ['SUSPENDED', 'CANCELLED'].includes(this.subscription()?.state ?? ''));
  /** Vencida: solo lectura (lo exige la base de datos). */
  readonly isReadOnly = computed(() => this.subscription()?.state === 'EXPIRED');

  constructor() {
    // Token borrado (cierre de sesión o 401 de la API): limpia los datos del usuario.
    effect(() => {
      if (this.tokens.token() === null) this.clearUser();
    });
  }

  /**
   * Se ejecuta antes del arranque (provideAppInitializer). Si la API no responde a tiempo
   * se descarta la sesión y se muestra el login, en lugar de dejar la página en blanco.
   */
  async init(): Promise<void> {
    if (!this.tokens.token()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), INIT_TIMEOUT_MS);
    });
    try {
      await Promise.race([this.loadProfile(), timeout]);
    } catch {
      this.tokens.clear();
    } finally {
      clearTimeout(timer);
    }
  }

  async loadProfile(): Promise<Profile | null> {
    if (!this.tokens.token()) {
      this.clearUser();
      return null;
    }
    const sesion = await this.api.get<SesionApi>('Login/sesion');
    // La sesión se cerró mientras llegaba la respuesta (p. ej. venció el tiempo de init).
    if (!this.tokens.token()) return null;
    const p = sesion.perfil;
    const profile: Profile | null =
      p?.org_id && p.role
        ? { id: p.id, org_id: p.org_id, full_name: p.full_name, email: p.email, phone: p.phone, role: p.role, active: p.active, created_at: '', updated_at: '' }
        : null;
    this.account.set(p ? { full_name: p.full_name, email: p.email } : null);
    this.profile.set(profile);
    this.subscription.set(sesion.suscripcion);
    this.branches.set(sesion.sucursales ?? []);
    this.isPlatformAdmin.set(p?.is_platform_admin === true);
    return profile;
  }

  async refreshSubscription(): Promise<void> {
    await this.loadProfile();
  }

  async signIn(email: string, password: string): Promise<Profile | null> {
    const r = await this.api.post<RespuestaLogin>('Login/validausuario', { email: email.trim(), clave: password });
    if (r.estado !== 1 || !r.token) throw new AppError(r.mensaje ?? 'Correo o contraseña incorrectos.');
    this.tokens.set(r.token);
    return this.loadProfile();
  }

  /** Envía el enlace para crear una nueva contraseña. La respuesta es la misma exista o no el correo. */
  async requestPasswordReset(email: string): Promise<void> {
    await this.api.procesar('Login/recuperarclave', { email: email.trim() });
  }

  /** Datos de una invitación pendiente (para la pantalla "Crear contraseña"). null si venció o ya se usó. */
  async invitation(token: string): Promise<{ email: string; full_name: string | null; company_name: string } | null> {
    try {
      return await this.api.get(`Login/invitacion/${encodeURIComponent(token)}`);
    } catch {
      return null;
    }
  }

  /** Define la contraseña desde el enlace del correo (invitación o recuperación) e inicia sesión. */
  async activateAccount(type: ActivationType, token: string, password: string): Promise<Profile | null> {
    const r = await this.api.procesar<{ email: string }>(
      type === 'invitacion' ? 'Login/aceptarinvitacion' : 'Login/restablecerclave',
      { token, clave: password },
    );
    const email = r.data?.email;
    if (!email) throw new AppError('Contraseña guardada. Inicie sesión con su correo.');
    return this.signIn(email, password);
  }

  /** Cambio de contraseña con sesión iniciada. */
  async changePassword(current: string, next: string): Promise<void> {
    await this.api.procesar('Login/cambiarclave', { clave_actual: current, clave_nueva: next });
  }

  async signOut(): Promise<void> {
    this.tokens.clear();
    await this.router.navigate(['/login']);
  }

  private clearUser(): void {
    this.account.set(null);
    this.profile.set(null);
    this.subscription.set(null);
    this.branches.set([]);
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
