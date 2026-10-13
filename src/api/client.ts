import React from 'react';
import { pdf } from '@react-pdf/renderer';
import { InvoicePdfDocument } from '../pdf/InvoicePdfDocument';
import type { InvoiceRecord } from '../../shared/types';

let currentCsrfToken: string | null = 'direct-access-mode';

export function setApiCsrfToken(token: string | null) {
  currentCsrfToken = token;
}

export function getApiCsrfToken(): string | null {
  return currentCsrfToken;
}

export async function apiRequest<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  if (currentCsrfToken) {
    headers.set('X-CSRF-Token', currentCsrfToken);
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'same-origin',
  });

  if (!res.ok) {
    let errMsg = `Request failed (${res.status})`;
    try {
      const errData = await res.json();
      if (errData?.error) errMsg = errData.error;
    } catch {
      // ignore json parse error
    }
    const err = new Error(errMsg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  return res.json();
}

/**
 * Downloads the authoritative server-stored PDF via authenticated private endpoint,
 * or falls back to client-side rendering with the exact same InvoicePdfDocument component for unfinalised drafts.
 */
export async function downloadInvoicePdf(
  invoice: InvoiceRecord,
  logoSrc: string,
  variant: 'ORIGINAL' | 'PAYMENT_SUMMARY' = 'ORIGINAL'
): Promise<void> {
  const safeNum = (invoice.invoiceNumber || `DRAFT-${invoice.id.slice(0, 8)}`).replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = variant === 'PAYMENT_SUMMARY' ? `${safeNum}_Payment_Summary.pdf` : `${safeNum}.pdf`;

  if (invoice.status === 'Finalised' && invoice.id && !invoice.id.startsWith('preview-')) {
    const queryVariant = variant === 'PAYMENT_SUMMARY' ? 'payment_summary' : 'original';
    const res = await fetch(`/api/invoices/${invoice.id}/pdf?variant=${queryVariant}`, {
      credentials: 'same-origin',
    });
    if (res.ok) {
      const blob = await res.blob();
      triggerBlobDownload(blob, filename);
      return;
    }
  }

  // Client-side vector PDF generation using @react-pdf/renderer
  const element = React.createElement(InvoicePdfDocument, {
    invoice,
    logoSrc: logoSrc || '/livotel-logo.jpg',
    copyVariant: variant,
  });
  const blob = await pdf(element as any).toBlob();
  triggerBlobDownload(blob, filename);
}

/**
 * Opens the generated selectable-text PDF in a new browser window/tab and triggers print.
 */
export async function printInvoicePdf(
  invoice: InvoiceRecord,
  logoSrc: string,
  variant: 'ORIGINAL' | 'PAYMENT_SUMMARY' = 'ORIGINAL'
): Promise<void> {
  const element = React.createElement(InvoicePdfDocument, {
    invoice,
    logoSrc: logoSrc || '/livotel-logo.jpg',
    copyVariant: variant,
  });
  const blob = await pdf(element as any).toBlob();
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (win) {
    win.addEventListener('load', () => {
      win.focus();
      win.print();
    });
  } else {
    triggerBlobDownload(blob, `${invoice.invoiceNumber || 'Invoice'}.pdf`);
  }
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
