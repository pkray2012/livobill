import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

const INVOICE_STORE_NAME = 'livotel-private-invoices';
const LOGO_STORE_NAME = 'livotel-brand-assets';

function getLocalBlobFilePath(storeName: string, key: string): string {
  const safeKey = key.replace(/[^a-zA-Z0-9._/-]/g, '_');
  const fullPath = path.resolve(process.cwd(), '.local-data/blobs', storeName, safeKey);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  return fullPath;
}

/**
 * Generates an unguessable internal object key for private invoice PDF storage.
 */
export function generatePrivateInvoiceBlobKey(
  financialYear: string,
  invoiceId: string,
  variant: 'original' | 'payment-summary'
): string {
  const randomToken = crypto.randomBytes(16).toString('hex');
  const fyClean = (financialYear || 'fy').replace(/[^a-zA-Z0-9-]/g, '');
  return `invoices/${fyClean}/${invoiceId}/${variant}-${randomToken}.pdf`;
}

/**
 * Stores a binary buffer in Netlify Blobs (or local `.local-data/blobs` in local dev/test).
 */
export async function putPrivateBlob(
  storeType: 'invoices' | 'logos',
  key: string,
  data: Uint8Array | Buffer,
  metadata: Record<string, string> = {}
): Promise<void> {
  const storeName = storeType === 'invoices' ? INVOICE_STORE_NAME : LOGO_STORE_NAME;
  const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;

  try {
    const store = getStore(storeName);
    await store.set(key, arrayBuffer, { metadata });
    return;
  } catch (err: any) {
    if (process.env.CONTEXT === 'production') {
      throw new Error(`Netlify Blobs storage failed in production: ${err?.message || String(err)}`);
    }
    const localFile = getLocalBlobFilePath(storeName, key);
    fs.writeFileSync(localFile, Buffer.from(data));
    fs.writeFileSync(`${localFile}.meta.json`, JSON.stringify(metadata, null, 2));
  }
}

/**
 * Reads a private binary blob from Netlify Blobs (or local `.local-data/blobs` in local dev/test).
 * Returns null if the object key does not exist.
 */
export async function getPrivateBlob(
  storeType: 'invoices' | 'logos',
  key: string
): Promise<Uint8Array | null> {
  if (!key) return null;
  const storeName = storeType === 'invoices' ? INVOICE_STORE_NAME : LOGO_STORE_NAME;

  try {
    const store = getStore(storeName);
    const buffer = await store.get(key, { type: 'arrayBuffer' });
    if (!buffer) return null;
    return new Uint8Array(buffer);
  } catch (err: any) {
    if (process.env.CONTEXT === 'production') {
      throw new Error(`Netlify Blobs retrieval failed in production: ${err?.message || String(err)}`);
    }
    const localFile = getLocalBlobFilePath(storeName, key);
    if (!fs.existsSync(localFile)) return null;
    return new Uint8Array(fs.readFileSync(localFile));
  }
}
