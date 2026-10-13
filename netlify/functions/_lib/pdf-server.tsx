import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { InvoicePdfDocument } from '../../../src/pdf/InvoicePdfDocument';
import type { InvoiceRecord } from '../../../shared/types';
import { loadDefaultLogoDataUrl, query } from './db';

/**
 * Resolves the exact versioned logo Data URL for an invoice so historical invoices
 * retain the logo version active when they were finalised.
 */
export async function resolveLogoForInvoice(logoVersionId: string | null): Promise<string> {
  if (logoVersionId) {
    const res = await query<{ data_url: string }>(
      `SELECT data_url FROM logo_versions WHERE id = $1 LIMIT 1`,
      [logoVersionId]
    );
    if (res.rows[0]?.data_url) {
      return res.rows[0].data_url;
    }
  }
  const latest = await query<{ data_url: string }>(
    `SELECT data_url FROM logo_versions ORDER BY version_number DESC LIMIT 1`
  );
  if (latest.rows[0]?.data_url) {
    return latest.rows[0].data_url;
  }
  return loadDefaultLogoDataUrl().dataUrl;
}

/**
 * Renders an A4 selectable-text PDF buffer on the server using the shared InvoicePdfDocument component.
 */
export async function renderInvoicePdfBuffer(
  invoice: InvoiceRecord,
  copyVariant: 'ORIGINAL' | 'PAYMENT_SUMMARY' = 'ORIGINAL'
): Promise<Buffer> {
  const logoSrc = await resolveLogoForInvoice(invoice.logoVersionId);
  const element = React.createElement(InvoicePdfDocument, {
    invoice,
    logoSrc,
    copyVariant,
  });
  return renderToBuffer(element as any);
}
