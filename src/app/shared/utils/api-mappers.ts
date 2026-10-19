/**
 * Adaptadores API → modelos del frontend.
 * La API (procedimientos api.usp_*) devuelve columnas planas (customer_name, assignee_name…);
 * los modelos mantienen los objetos anidados que usaban las consultas de Supabase.
 */
import { OrderDetail, OrderHistoryEntry, OrderRow, OrderStage } from '../../features/orders/models/order.model';
import { QuotationDetail, QuotationItem, QuotationRow } from '../../features/quotations/models/quotation.model';
import { Payment } from '../../features/payments/models/payment.model';
import { Delivery } from '../../features/deliveries/models/delivery.model';
import { MaterialMovement } from '../../features/materials/models/material.model';
import { AppError } from './db';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ref = (id: unknown, name: unknown) => (id ? { id: id as string, full_name: (name as string) ?? '' } : null);

export function mapOrderRow(r: Row): OrderRow {
  return {
    ...r,
    customer: ref(r['customer_id'], r['customer_name']),
    service_type: r['service_name'] ? { name: r['service_name'] } : null,
    assignee: ref(r['assigned_to'], r['assignee_name']),
  } as OrderRow;
}

export function mapOrderDetail(pedido: Row, items: QuotationItem[]): OrderDetail {
  return {
    ...pedido,
    items: [...items].sort((a, b) => a.position - b.position),
    service_type: pedido['service_name'] ? { name: pedido['service_name'] } : null,
    assignee: ref(pedido['assigned_to'], pedido['assignee_name']),
    quotation: pedido['quotation_id'] ? { id: pedido['quotation_id'], number: pedido['quotation_number'] } : null,
    jeweler: pedido['jeweler_id']
      ? {
          id: pedido['jeweler_id'],
          full_name: pedido['jeweler_name'],
          document_number: pedido['jeweler_document'] ?? null,
          phone: pedido['jeweler_phone'] ?? null,
        }
      : null,
    customer: pedido['customer_id']
      ? {
          id: pedido['customer_id'],
          full_name: pedido['customer_name'],
          document_type: pedido['customer_document_type'],
          document_number: pedido['customer_document_number'],
          phone: pedido['customer_phone'],
          whatsapp: pedido['customer_whatsapp'],
          email: pedido['customer_email'],
          address: pedido['customer_address'],
        }
      : null,
  } as OrderDetail;
}

export function mapStage(r: Row, orderId?: string): OrderStage {
  return { order_id: orderId, ...r, assignee: ref(r['assigned_to'], r['assignee_name']) } as OrderStage;
}

export function mapHistory(r: Row): OrderHistoryEntry {
  return { ...r, order: r['order_number'] ? { number: r['order_number'] } : null } as OrderHistoryEntry;
}

export function mapQuotationRow(r: Row): QuotationRow {
  return {
    ...r,
    customer: ref(r['customer_id'], r['customer_name']),
    service_type: r['service_name'] ? { name: r['service_name'] } : null,
    order: r['order_id'] ? { id: r['order_id'], number: r['order_number'] } : null,
  } as QuotationRow;
}

export function mapQuotationDetail(q: Row, items: QuotationItem[]): QuotationDetail {
  return {
    ...q,
    items: [...items].sort((a, b) => a.position - b.position),
    service_type: q['service_name'] ? { name: q['service_name'] } : null,
    order: q['order_id'] ? { id: q['order_id'], number: q['order_number'] } : null,
    customer: q['customer_id']
      ? {
          id: q['customer_id'],
          full_name: q['customer_name'],
          document_type: q['customer_document_type'],
          document_number: q['customer_document_number'],
          phone: q['customer_phone'],
          email: q['customer_email'],
          address: q['customer_address'],
        }
      : null,
  } as QuotationDetail;
}

export function mapPayment(r: Row): Payment {
  return {
    ...r,
    order: r['order_id']
      ? {
          id: r['order_id'],
          number: r['order_number'],
          title: r['order_title'],
          customer: r['customer_id']
            ? {
                id: r['customer_id'],
                full_name: r['customer_name'] ?? '',
                document_type: r['customer_document_type'] ?? null,
                document_number: r['customer_document_number'] ?? null,
              }
            : null,
        }
      : null,
  } as Payment;
}

export function mapDelivery(r: Row): Delivery {
  return {
    ...r,
    order: r['order_id']
      ? {
          id: r['order_id'],
          number: r['order_number'],
          title: r['order_title'],
          balance: r['order_balance'],
          status: r['order_status'],
          qc_approved: r['qc_approved'],
        }
      : null,
    customer: ref(r['customer_id'], r['customer_name']),
    responsible: r['responsible_name'] ? { full_name: r['responsible_name'] } : null,
  } as Delivery;
}

export function mapMovement(r: Row): MaterialMovement {
  return {
    ...r,
    material: r['material_id']
      ? { id: r['material_id'], name: r['material_name'], purity: r['material_purity'], unit: r['material_unit'] }
      : null,
    order: r['order_id'] ? { id: r['order_id'], number: r['order_number'] } : null,
    creator: r['created_by_name'] ? { full_name: r['created_by_name'] } : null,
  } as MaterialMovement;
}

/**
 * Para secciones que el rol no puede ver (antes RLS devolvía una lista vacía; ahora la API responde 403):
 * devuelve [] en lugar de fallar.
 */
export async function orEmpty<T>(promise: Promise<T[]>): Promise<T[]> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof AppError && (err.code === '403' || err.code === '50003')) return [];
    throw err;
  }
}
