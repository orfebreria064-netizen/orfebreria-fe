import { Injectable, inject, signal } from '@angular/core';
import { Bank, BankAccount, BankAccountInput, BankAccountsSummary } from '../models/bank.model';
import { unwrap } from '../../shared/utils/db';
import { SupabaseService } from './supabase.service';

/** Bancos y cuentas de la empresa. Escritura solo ADMIN (funciones de 0027_bancos_cuentas.sql). */
@Injectable({ providedIn: 'root' })
export class BankAccountsService {
  private readonly db = inject(SupabaseService).client;

  /** Caché para los diálogos de cobro y gasto. */
  readonly accounts = signal<BankAccount[]>([]);
  private loaded: Promise<BankAccount[]> | null = null;

  async banks(includeInactive = false): Promise<Bank[]> {
    let query = this.db.from('banks').select('*').order('code');
    if (!includeInactive) query = query.eq('active', true);
    return unwrap(await query) as Bank[];
  }

  async list(): Promise<BankAccount[]> {
    const rows = unwrap(
      await this.db
        .from('bank_accounts')
        .select('*, bank:banks(id, code, short_name, name)')
        .order('active', { ascending: false })
        .order('account_type')
        .order('currency')
        .order('alias'),
    ) as BankAccount[];
    this.accounts.set(rows);
    return rows;
  }

  /** Carga una vez por sesión (los diálogos la usan); `refresh` fuerza recarga. */
  ensureLoaded(refresh = false): Promise<BankAccount[]> {
    if (refresh || !this.loaded) {
      this.loaded = this.list().catch((err) => {
        this.loaded = null;
        throw err;
      });
    }
    return this.loaded;
  }

  async save(id: string | null, input: BankAccountInput): Promise<string> {
    const r = unwrap(await this.db.rpc('save_bank_account', { p_id: id, p_data: input })) as string;
    await this.ensureLoaded(true);
    return r;
  }

  async remove(id: string): Promise<void> {
    unwrap(await this.db.rpc('delete_bank_account', { p_id: id }));
    await this.ensureLoaded(true);
  }

  async saveBank(id: string | null, input: Omit<Bank, 'id'>): Promise<string> {
    return unwrap(await this.db.rpc('save_bank', { p_id: id, p_data: input })) as string;
  }

  async summary(from: string, to: string): Promise<BankAccountsSummary> {
    return unwrap(await this.db.rpc('bank_accounts_summary', { p_from: from, p_to: to })) as BankAccountsSummary;
  }
}
