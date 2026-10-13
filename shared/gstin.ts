export interface IndianStateInfo {
  code: string;
  name: string;
}

export const INDIAN_GST_STATES: IndianStateInfo[] = [
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '25', name: 'Daman and Diu' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '28', name: 'Andhra Pradesh (Old)' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman and Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
  { code: '97', name: 'Other Territory' },
];

const STATE_MAP = new Map<string, string>(INDIAN_GST_STATES.map((s) => [s.code, s.name]));
const GSTIN_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export interface GstinValidationResult {
  isValid: boolean;
  normalized: string;
  stateCode: string | null;
  stateName: string | null;
  pan: string | null;
  error: string | null;
  advisory: string;
}

/**
 * Computes the official GSTIN Mod-36 check character for the first 14 characters.
 * Never exposed to auto-guess user input; strictly used to verify the 15th character.
 */
export function computeGstinCheckChar(first14: string): string {
  let factor = 1;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const codePoint = GSTIN_ALPHABET.indexOf(first14[i]);
    if (codePoint === -1) return '';
    const product = codePoint * factor;
    factor = factor === 1 ? 2 : 1;
    sum += Math.floor(product / 36) + (product % 36);
  }
  const rem = sum % 36;
  const checkCodePoint = (36 - rem) % 36;
  return GSTIN_ALPHABET[checkCodePoint];
}

/**
 * Normalizes and validates an Indian GSTIN.
 * - Trims whitespace and converts to uppercase.
 * - Validates 15-character length, state code (01-38/97), embedded PAN format, 'Z' at pos 14, and Mod-36 checksum.
 * - Never guesses missing characters (e.g., rejects 13-character '21AAACS8577K1').
 */
export function validateGstin(rawInput: string | null | undefined): GstinValidationResult {
  const normalized = (rawInput ?? '').trim().toUpperCase().replace(/\s+/g, '');
  const advisory =
    'Structural and checksum validation only; this does not verify active GST registration status on the government portal.';

  if (!normalized) {
    return {
      isValid: false,
      normalized: '',
      stateCode: null,
      stateName: null,
      pan: null,
      error: 'GSTIN is empty.',
      advisory,
    };
  }

  if (normalized.length !== 15) {
    return {
      isValid: false,
      normalized,
      stateCode: null,
      stateName: null,
      pan: null,
      error: `GSTIN must be exactly 15 characters (received ${normalized.length} characters). Incomplete GSTINs cannot be used; missing characters are never guessed.`,
      advisory,
    };
  }

  const stateCode = normalized.slice(0, 2);
  const stateName = STATE_MAP.get(stateCode) ?? null;
  if (!stateName) {
    return {
      isValid: false,
      normalized,
      stateCode,
      stateName: null,
      pan: null,
      error: `Invalid GST state code "${stateCode}" in GSTIN prefix.`,
      advisory,
    };
  }

  const pan = normalized.slice(2, 12);
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(pan)) {
    return {
      isValid: false,
      normalized,
      stateCode,
      stateName,
      pan,
      error: `Characters 3–12 ("${pan}") do not form a valid 10-character PAN structure (AAAAA9999A).`,
      advisory,
    };
  }

  const entityChar = normalized[12];
  if (!/^[1-9A-Z]$/.test(entityChar)) {
    return {
      isValid: false,
      normalized,
      stateCode,
      stateName,
      pan,
      error: `Character 13 ("${entityChar}") must be a valid entity registration code (1–9 or A–Z).`,
      advisory,
    };
  }

  if (normalized[13] !== 'Z') {
    return {
      isValid: false,
      normalized,
      stateCode,
      stateName,
      pan,
      error: `Character 14 must be "Z" (found "${normalized[13]}").`,
      advisory,
    };
  }

  const expectedCheck = computeGstinCheckChar(normalized.slice(0, 14));
  const actualCheck = normalized[14];
  if (actualCheck !== expectedCheck) {
    return {
      isValid: false,
      normalized,
      stateCode,
      stateName,
      pan,
      error: 'GSTIN checksum verification failed (15th character does not match the Mod-36 check digit). Please check for typos.',
      advisory,
    };
  }

  return {
    isValid: true,
    normalized,
    stateCode,
    stateName,
    pan,
    error: null,
    advisory,
  };
}

export function validatePan(rawPan: string | null | undefined): { isValid: boolean; normalized: string; error: string | null } {
  const normalized = (rawPan ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!normalized) return { isValid: true, normalized: '', error: null };
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(normalized)) {
    return {
      isValid: false,
      normalized,
      error: 'PAN must be 10 characters in format AAAAA9999A.',
    };
  }
  return { isValid: true, normalized, error: null };
}

/**
 * Validates GST Invoice Number compliance under Rule 46(b) of CGST Rules:
 * - Max 16 characters
 * - Alphanumeric with only '/' or '-' special characters allowed
 * - Unique for a financial year
 */
export function validateGstInvoiceNumber(invoiceNumber: string): { isValid: boolean; error: string | null } {
  const trimmed = invoiceNumber.trim();
  if (!trimmed) {
    return { isValid: false, error: 'Invoice number cannot be empty.' };
  }
  if (trimmed.length > 16) {
    return {
      isValid: false,
      error: `GST invoice number "${trimmed}" is ${trimmed.length} characters; CGST Rule 46(b) permits at most 16 characters.`,
    };
  }
  if (!/^[A-Z0-9\/-]+$/.test(trimmed)) {
    return {
      isValid: false,
      error: 'GST invoice number may only contain uppercase letters, digits, hyphens (-), and forward slashes (/).',
    };
  }
  return { isValid: true, error: null };
}
