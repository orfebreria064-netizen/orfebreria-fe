import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'aurum.token';

/** JWT emitido por la API (Login/validausuario). Se descarta si venció. */
@Injectable({ providedIn: 'root' })
export class TokenService {
  readonly token = signal<string | null>(this.read());

  set(token: string): void {
    try {
      localStorage.setItem(STORAGE_KEY, token);
    } catch {
      // Navegación privada sin storage: la sesión dura lo que la pestaña.
    }
    this.token.set(token);
  }

  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // sin storage
    }
    this.token.set(null);
  }

  private read(): string | null {
    let token: string | null = null;
    try {
      token = localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
    if (!token || isExpired(token)) return null;
    return token;
  }
}

function isExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}
