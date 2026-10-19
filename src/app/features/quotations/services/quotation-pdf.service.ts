import { Injectable, inject } from '@angular/core';
import { LookupService } from '../../../core/services/lookup.service';
import { quotationDocData, renderCommercialDoc } from '../../../shared/pdf/commercial-doc';
import { createPdf, outputPdf } from '../../../shared/pdf/pdf-kit';
import { QuotationDetail } from '../models/quotation.model';

/** PDF de la cotización con el formato del talonario de la empresa (jsPDF se carga bajo demanda). */
@Injectable({ providedIn: 'root' })
export class QuotationPdfService {
  private readonly lookups = inject(LookupService);

  async download(q: QuotationDetail): Promise<void> {
    await this.render(q, 'download');
  }

  async print(q: QuotationDetail): Promise<void> {
    await this.render(q, 'print');
  }

  private async render(q: QuotationDetail, mode: 'print' | 'download'): Promise<void> {
    await this.lookups.ensureLoaded();
    const ctx = await createPdf(this.lookups.settings(), 'a4');
    renderCommercialDoc(ctx, quotationDocData(q));
    outputPdf(ctx.doc, mode, `${q.number}.pdf`);
  }
}
