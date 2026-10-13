/**
 * Hotel Date & Time Utilities (Asia/Kolkata Time Zone)
 * Ensures local calendar date stability across browsers and server environments.
 */

const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export interface ParsedLocalDateTime {
  year: number;
  month: number; // 1-12
  day: number;   // 1-31
  hour: number;  // 0-23
  minute: number;// 0-59
  datePart: string; // YYYY-MM-DD
}

/**
 * Returns current date in Asia/Kolkata as YYYY-MM-DD.
 */
export function getKolkataTodayDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
}

/**
 * Returns Indian Financial Year string (e.g., "26-27") for a given YYYY-MM-DD date.
 */
export function getIndianFinancialYear(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr.trim());
  if (!m) return '26-27';
  const year = Number(m[1]);
  const month = Number(m[2]);
  const startYear = month >= 4 ? year : year - 1;
  const endYear = startYear + 1;
  return `${String(startYear).slice(-2)}-${String(endYear).slice(-2)}`;
}

/**
 * Parses a local hotel datetime string ("YYYY-MM-DDTHH:mm" or "YYYY-MM-DD") without timezone shift.
 */
export function parseLocalDateTime(input: string): ParsedLocalDateTime | null {
  const trimmed = (input ?? '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = match[4] !== undefined ? Number(match[4]) : 12;
  const minute = match[5] !== undefined ? Number(match[5]) : 0;

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  const testUtc = new Date(Date.UTC(year, month - 1, day));
  if (
    testUtc.getUTCFullYear() !== year ||
    testUtc.getUTCMonth() !== month - 1 ||
    testUtc.getUTCDate() !== day
  ) {
    return null;
  }
  return {
    year,
    month,
    day,
    hour,
    minute,
    datePart: `${match[1]}-${match[2]}-${match[3]}`,
  };
}

/**
 * Calculates suggested nights strictly from local calendar dates in Asia/Kolkata,
 * NOT by rounding elapsed hours into 24-hour blocks.
 * Also validates that checkout is not before check-in.
 */
export function calculateStayNights(
  checkInAt: string,
  checkOutAt: string
): {
  isValid: boolean;
  error: string | null;
  calendarDayDiff: number;
  suggestedNights: number;
} {
  const checkIn = parseLocalDateTime(checkInAt);
  const checkOut = parseLocalDateTime(checkOutAt);

  if (!checkIn) {
    return { isValid: false, error: 'Invalid check-in date/time.', calendarDayDiff: 0, suggestedNights: 1 };
  }
  if (!checkOut) {
    return { isValid: false, error: 'Invalid check-out date/time.', calendarDayDiff: 0, suggestedNights: 1 };
  }

  const checkInTimestampMinutes =
    Date.UTC(checkIn.year, checkIn.month - 1, checkIn.day, checkIn.hour, checkIn.minute) / 60000;
  const checkOutTimestampMinutes =
    Date.UTC(checkOut.year, checkOut.month - 1, checkOut.day, checkOut.hour, checkOut.minute) / 60000;

  if (checkOutTimestampMinutes <= checkInTimestampMinutes) {
    return {
      isValid: false,
      error: 'Check-out date and time must be after check-in date and time.',
      calendarDayDiff: 0,
      suggestedNights: 1,
    };
  }

  const inCalendarMidnight = Date.UTC(checkIn.year, checkIn.month - 1, checkIn.day);
  const outCalendarMidnight = Date.UTC(checkOut.year, checkOut.month - 1, checkOut.day);
  const calendarDayDiff = Math.round((outCalendarMidnight - inCalendarMidnight) / (24 * 60 * 60 * 1000));

  // If check-out is on the same calendar day (day-use), suggested nights is 1; otherwise exact calendar day difference.
  const suggestedNights = Math.max(1, calendarDayDiff);

  return {
    isValid: true,
    error: null,
    calendarDayDiff,
    suggestedNights,
  };
}

export function getOrdinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return 'th';
  switch (day % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}

export function format12HourTime(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const minStr = String(minute).padStart(2, '0');
  return `${h12}:${minStr} ${period}`;
}

/**
 * Formats Invoice Date matching the reference PDFs:
 * e.g. "23 February 2026" or "07 September 2026"
 */
export function formatInvoiceDateDisplay(dateStr: string): string {
  const parsed = parseLocalDateTime(dateStr);
  if (!parsed) return dateStr;
  const dayStr = String(parsed.day).padStart(2, '0');
  const monthName = MONTHS_FULL[parsed.month - 1];
  return `${dayStr} ${monthName} ${parsed.year}`;
}

/**
 * Formats Stay Period line matching the reference PDFs:
 * - Without time (PDF 1 style): "20th February 2026 – 22nd February 2026 (2 Nights)"
 * - With time (PDF 2 style): "05th September 2026 at 11:00 PM – 07th September 2026 at 5:00 AM (2 Nights)"
 */
export function formatStayPeriodDisplay(
  checkInAt: string,
  checkOutAt: string,
  billableNights: number,
  showStayTimes: boolean
): string {
  const checkIn = parseLocalDateTime(checkInAt);
  const checkOut = parseLocalDateTime(checkOutAt);
  const nightLabel = billableNights === 1 ? '1 Night' : `${billableNights} Nights`;

  if (!checkIn || !checkOut) {
    return `${checkInAt} – ${checkOutAt} (${nightLabel})`;
  }

  const inDayStr = showStayTimes ? String(checkIn.day).padStart(2, '0') : String(checkIn.day);
  const outDayStr = showStayTimes ? String(checkOut.day).padStart(2, '0') : String(checkOut.day);

  const inDateFormatted = `${inDayStr}${getOrdinalSuffix(checkIn.day)} ${MONTHS_FULL[checkIn.month - 1]} ${checkIn.year}`;
  const outDateFormatted = `${outDayStr}${getOrdinalSuffix(checkOut.day)} ${MONTHS_FULL[checkOut.month - 1]} ${checkOut.year}`;

  if (showStayTimes) {
    const inTime = format12HourTime(checkIn.hour, checkIn.minute);
    const outTime = format12HourTime(checkOut.hour, checkOut.minute);
    return `${inDateFormatted} at ${inTime} – ${outDateFormatted} at ${outTime} (${nightLabel})`;
  }

  return `${inDateFormatted} – ${outDateFormatted} (${nightLabel})`;
}
