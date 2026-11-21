const THAI_MONTHS_FULL = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];

const THAI_MONTHS_SHORT = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
];

// Official recurring Thai public holidays (MM-DD) + key 2026-2027 dates (YYYY-MM-DD)
const FIXED_THAI_HOLIDAYS = new Set([
  '01-01', // New Year
  '04-06', // Chakri Day
  '04-13', // Songkran
  '04-14', // Songkran
  '04-15', // Songkran
  '05-04', // Coronation Day
  '06-03', // Queen Suthida Birthday
  '07-28', // King Rama X Birthday
  '08-12', // Mother's Day
  '10-13', // King Rama IX Memorial Day
  '10-23', // Chulalongkorn Day
  '12-05', // Father's Day
  '12-10', // Constitution Day
  '12-31', // New Year's Eve
]);

const SPECIFIC_THAI_HOLIDAYS = new Set([
  '2026-03-03', // Makha Bucha
  '2026-05-01', // Labor / Visakha area
  '2026-05-31', // Visakha Bucha
  '2026-07-29', // Asalha Bucha
  '2026-07-30', // Buddhist Lent
  '2027-02-21', // Makha Bucha
  '2027-05-20', // Visakha Bucha
  '2027-07-19', // Asalha Bucha
]);

export function parseIsoDate(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return null;
  }
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) {
    return null;
  }
  return dt;
}

export function formatThaiDateFull(iso: string): string {
  const dt = parseIsoDate(iso);
  if (!dt) return iso || '-';
  const d = dt.getDate();
  const m = THAI_MONTHS_FULL[dt.getMonth()];
  const y = dt.getFullYear() + 543;
  return `${d} ${m} ${y}`;
}

export function formatThaiDateShort(iso: string): string {
  const dt = parseIsoDate(iso);
  if (!dt) return iso || '-';
  const d = dt.getDate();
  const m = THAI_MONTHS_SHORT[dt.getMonth()];
  const y = String(dt.getFullYear() + 543).slice(-2);
  return `${d} ${m} ${y}`;
}

export function getThaiDateParts(iso: string): { day: string; month: string; year: string } {
  const dt = parseIsoDate(iso);
  if (!dt) return { day: '', month: '', year: '' };
  return {
    day: String(dt.getDate()),
    month: THAI_MONTHS_FULL[dt.getMonth()],
    year: String(dt.getFullYear() + 543),
  };
}

export function getFiscalYearFromIso(iso: string): number {
  const dt = parseIsoDate(iso) ?? new Date();
  const y = dt.getFullYear();
  const m = dt.getMonth() + 1; // 1-12
  // Thai government fiscal year: Oct (10) - Dec (12) belongs to next Buddhist year
  return m >= 10 ? y + 544 : y + 543;
}

export function getCurrentFiscalYear(): number {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  return m >= 10 ? y + 544 : y + 543;
}

export function toLocalIsoDate(dt: Date): string {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatThaiMonthYear(year: number, monthIndex: number): string {
  const monthName = THAI_MONTHS_FULL[monthIndex] ?? '';
  return `${monthName} ${year + 543}`;
}

export function isThaiOfficialHoliday(dt: Date): boolean {
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return FIXED_THAI_HOLIDAYS.has(`${mm}-${dd}`) || SPECIFIC_THAI_HOLIDAYS.has(`${yyyy}-${mm}-${dd}`);
}

export function isThaiHolidayOrWeekend(dt: Date): boolean {
  const day = dt.getDay();
  if (day === 0 || day === 6) return true;
  return isThaiOfficialHoliday(dt);
}

export function calculateWorkingDays(startIso: string, endIso: string): number {
  const start = parseIsoDate(startIso);
  const end = parseIsoDate(endIso);
  if (!start || !end || end < start) {
    return 0;
  }
  let count = 0;
  const cursor = new Date(start.getTime());
  let guard = 0;
  while (cursor <= end && guard < 366) {
    if (!isThaiHolidayOrWeekend(cursor)) {
      count += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }
  return count;
}

export function calculateCalendarDays(startIso: string, endIso: string): number {
  const start = parseIsoDate(startIso);
  const end = parseIsoDate(endIso);
  if (!start || !end || end < start) return 0;
  const diff = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return diff + 1;
}

export function toThaiNumerals(input: string | number): string {
  const map = ['๐', '๑', '๒', '๓', '๔', '๕', '๖', '๗', '๘', '๙'];
  return String(input).replace(/\d/g, (d) => map[Number(d)]);
}
