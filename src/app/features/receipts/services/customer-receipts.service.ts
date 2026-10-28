import { Injectable, inject } from '@angular/core';
import { LookupService } from '../../../core/services/lookup.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { createPdf, outputPdf } from '../../../shared/pdf/pdf-kit';
import { toAppError, unwrap } from '../../../shared/utils/db';
import { renderCustomerReceipt } from '../pdf/customer-receipt-doc';

export type ReceiptKind = 'MATERIAL' | 'REPARACION';

export interface CustomerReceiptItem {
  id?: string;
  position?: number;
  description: string;
  material_id: string | null;
  purity: string | null;
  quantity: number;
  weight_g: number | null;
  carats: number | null;
  movement_id?: string | null;
}

export interface CustomerReceipt {
  id: string;
  number: string;
  order_id: string;
  customer_id: string;
  kind: ReceiptKind;
  received_at: string;
  delivered_by: string | null;
  delivered_by_doc: string | null;
  reported_issue: string | null;
  condition_notes: string | null;
  signature_path: string | null;
  returned_at: string | null;
  returned_weight: number | null;
  return_notes: string | null;
  voided: boolean;
  void_reason: string | null;
  weight_in: number | null;
  items: CustomerReceiptItem[];
  customer?: { full_name: string; document_type: string | null; document_number: string | null; phone: string | null } | null;
  order?: { id: string; number: string; title: string; status: string; due_date: string | null; total: number; balance: number; currency: string } | null;
  creator?: { full_name: string } | null;
}

export interface ReceiptInput {
  delivered_by: string | null;
  delivered_by_doc: string | null;
  reported_issue: string | null;
  condition_notes: string | null;
}

export interface RepairInput extends ReceiptInput {
  customer_id: string;
  title: string;
  due_date: string | null;
  price: number | null;
  currency: string;
  tax_rate: number;
}

const SELECT =
  '*, weight_in, items:customer_receipt_items(*), customer:customers(full_name, document_type, document_number, phone), ' +
  'order:orders(id, number, title, status, due_date, total, balance, currency), creator:profiles!customer_receipts_created_by_fkey(full_name)';

/** Actas de recepción: material del cliente y piezas para reparación (0021_actas_recepcion_reparaciones.sql). */
@Injectable({ providedIn: 'root' })
export class CustomerReceiptsService {
  private readonly db = inject(SupabaseService).client;
  private readonly lookups = inject(LookupService);

  async byOrder(orderId: string): Promise<CustomerReceipt[]> {
    const rows = unwrap(await this.db.from('customer_receipts').select(SELECT).eq('order_id', orderId).order('received_at')) as unknown as CustomerReceipt[];
    return rows.map(sortItems);
  }

  async list(kind: ReceiptKind, options: { open?: boolean } = {}): Promise<CustomerReceipt[]> {
    let query = this.db.from('customer_receipts').select(SELECT).eq('kind', kind).eq('voided', false).order('received_at', { ascending: false }).limit(300);
    if (options.open) query = query.is('returned_at', null);
    return (unwrap(await query) as unknown as CustomerReceipt[]).map(sortItems);
  }

  async register(orderId: string, kind: ReceiptKind, data: ReceiptInput, items: CustomerReceiptItem[]): Promise<{ id: string; number: string; material_entries: boolean }> {
    return unwrap(
      await this.db.rpc('register_customer_receipt', { p_order_id: orderId, p_kind: kind, p_data: data, p_items: items }),
    ) as { id: string; number: string; material_entries: boolean };
  }

  async registerRepair(data: RepairInput, items: CustomerReceiptItem[]): Promise<{ order_id: string; order_number: string; receipt_id: string; receipt_number: string }> {
    return unwrap(await this.db.rpc('register_repair', { p_data: data, p_items: items })) as {
      order_id: string;
      order_number: string;
      receipt_id: string;
      receipt_number: string;
    };
  }

  async markReturned(id: string, weight: number | null, notes: string | null): Promise<void> {
    unwrap(await this.db.rpc('return_customer_receipt', { p_id: id, p_returned_weight: weight, p_notes: notes }));
  }

  async void(id: string, reason: string): Promise<void> {
    unwrap(await this.db.rpc('void_customer_receipt', { p_id: id, p_reason: reason }));
  }

  /** Firma del cliente (PNG) en el bucket del pedido. */
  async saveSignature(receiptId: string, orderId: string, png: Blob): Promise<void> {
    const path = `${orderId}/firma-acta-${receiptId}-${Date.now()}.png`;
    const { error } = await this.db.storage.from('orders').upload(path, png, { contentType: 'image/png' });
    if (error) throw toAppError(error);
    unwrap(await this.db.rpc('set_customer_receipt_signature', { p_id: receiptId, p_path: path }));
  }

  async get(id: string): Promise<CustomerReceipt> {
    return sortItems(unwrap(await this.db.from('customer_receipts').select(SELECT).eq('id', id).single()) as unknown as CustomerReceipt);
  }

  /** Acta en PDF (A5 horizontal), con la firma si se registró. */
  async print(receipt: CustomerReceipt | string, mode: 'print' | 'download' = 'print'): Promise<void> {
    const r = typeof receipt === 'string' ? await this.get(receipt) : receipt;
    await this.lookups.ensureLoaded();
    let signature: string | null = null;
    if (r.signature_path) {
      const { data } = await this.db.storage.from('orders').download(r.signature_path);
      if (data) signature = await blobToDataUrl(data);
    }
    const ctx = await createPdf(this.lookups.settings(), 'a5', 'landscape');
    renderCustomerReceipt(ctx, r, signature);
    outputPdf(ctx.doc, mode, `${r.number}.pdf`);
  }
}

function sortItems(r: CustomerReceipt): CustomerReceipt {
  return { ...r, items: [...(r.items ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)) };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
