export const collections = ['targets', 'contacts', 'roles', 'outreach', 'posts', 'interviews', 'board', 'weeks', 'engage', 'firms', 'stories', 'offers', 'refs'] as const;
export type Collection = typeof collections[number];
export type Row = { id?: string; example?: boolean; [key: string]: unknown };
export type Backup = { settings: Record<string, unknown> } & Record<Collection, Row[]>;
export const defaultSettings = {
  currency: 'USD', floor: '0', compTarget: '0', touchGoal: '10', postGoal: '3', engageGoal: '60',
  positioning: '', resume: '', tools: [],
  scriptA: 'Hi [name], I am exploring Global Head opportunities in [scope]. Would a short conversation be useful?',
  scriptB: 'Hi [name], would you be comfortable introducing me to [contact] at [company]? Here is a short note you can forward: [proof point].',
  scriptC: 'Hi [name], your work on [priority] caught my attention. I would welcome a short discussion about [relevant scope]. [proof point]',
};
const configuredTargets = [
  ['Microsoft', 'Microsoft Azure,Azure,Microsoft Corporation'],
  ['Amazon Web Services', 'AWS,Amazon Web Services (AWS),Amazon'],
  ['Google Cloud', 'Google,GCP,Google Cloud Platform'],
  ['IBM (Apptio)', 'IBM,Apptio,IBM Apptio'],
  ['Flexera', 'Flexera Software'], ['CloudZero', 'Cloud Zero'], ['Vantage', 'Vantage.sh'],
  ['Credo AI', 'CredoAI'], ['Holistic AI', 'HolisticAI'], ['Monitaur', 'Monitaur AI'],
];
export function initialBackup(): Backup {
  return {
    settings: { ...defaultSettings }, targets: configuredTargets.map(([name, aliases], index) => ({ id: `target-${index + 1}`, name, aliases })),
    contacts: [], roles: [], outreach: [], posts: [], interviews: [], board: [], weeks: [],
    engage: [], firms: [], stories: [], offers: [], refs: [],
  };
}
const isRecord = (value: unknown): value is Row => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export const toolRows = (settings: Backup['settings']): Row[] => Array.isArray(settings.tools) ? settings.tools.filter(isRecord) : [];

function withRowIds(rows: Row[], replacedIds?: Map<string, string | undefined>): Row[] {
  const validId = (id: unknown): id is string => typeof id === 'string' && Boolean(id.trim());
  const reserved = new Set(rows.map(row => row.id).filter(validId));
  const kept = new Set(reserved);
  const used = new Set<string>();
  return rows.map(row => {
    if (validId(row.id) && !used.has(row.id)) {
      used.add(row.id);
      return row;
    }
    let next = newRow(row);
    while (reserved.has(next.id)) next = newRow(row);
    reserved.add(next.id);
    if (replacedIds && (typeof row.id === 'number' || (typeof row.id === 'string' && row.id && !validId(row.id)))) {
      const key = String(row.id);
      replacedIds.set(key, replacedIds.has(key) || kept.has(key) ? undefined : next.id);
    }
    return next;
  });
}

const linkedCollections: Partial<Record<Collection, { field: string; lists: Collection[] }>> = {
  targets: { field: 'targetId', lists: ['contacts', 'roles', 'outreach', 'engage'] },
  contacts: { field: 'contactId', lists: ['outreach'] },
  roles: { field: 'roleId', lists: ['interviews', 'offers', 'refs'] },
};

export function importBackup(text: string): Backup {
  const data: unknown = JSON.parse(text);
  if (!isRecord(data) || !isRecord(data.settings) || collections.some(key => {
    const items = data[key];
    return !Array.isArray(items) || !items.every(isRecord);
  })) throw new Error('Choose a backup with settings and all 13 data lists.');
  const backup = data as Backup;
  const tools = backup.settings.tools;
  if (tools !== undefined && (!Array.isArray(tools) || !tools.every(isRecord))) {
    throw new Error('Backup tool budget must be a list of records.');
  }
  for (const key of collections) {
    const link = linkedCollections[key];
    const ids = link && new Map<string, string | undefined>();
    backup[key] = withRowIds(backup[key], ids);
    if (!link || !ids?.size) continue;
    const { field, lists } = link;
    for (const list of lists) {
      for (const row of backup[list]) {
        const linked = row[field];
        if (typeof linked !== 'number' && typeof linked !== 'string') continue;
        const replacement = ids.get(String(linked));
        if (replacement !== undefined) row[field] = replacement;
      }
    }
  }
  if (Array.isArray(tools)) backup.settings.tools = withRowIds(tools);
  return backup;
}
export function exportBackup(data: Backup) {
  const settings = data.settings.tools === undefined ? data.settings : { ...data.settings, tools: toolRows(data.settings) };
  return JSON.stringify({ ...data, settings }, null, 2);
}
export function removeExamples(data: Backup): Backup {
  const next = structuredClone(data);
  for (const key of collections) next[key] = next[key].filter(row => row.example !== true);
  if (Array.isArray(next.settings.tools)) next.settings.tools = next.settings.tools.filter(row => !isRecord(row) || row.example !== true);
  return next;
}
export const value = (row: Row, key: string) => String(row[key] ?? '');
function uuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}
export const newRow = (fields: Row = {}): Row & { id: string } => ({ ...fields, id: uuid() });
export const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export function weekStart(date = new Date()) {
  const day = new Date(date);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return localDate(day);
}
export const inWeek = (date: string, now = new Date()) => date >= weekStart(now) && date <= localDate(now);
export function minorUnits(amount: unknown, digits: number) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return 0;
  const [coefficient, exponent = '0'] = numeric.toString().split('e');
  return Math.round(Number(`${coefficient}e${Number(exponent) + digits}`));
}
function bonusMinorUnits(base: number, rate: unknown) {
  const percent = Number(rate);
  if (!Number.isFinite(base) || !Number.isFinite(percent) || !percent) return 0;
  const decimal = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i;
  const [, sign, whole, fraction = '', exponent = '0'] = decimal.exec(String(rate).trim()) ?? decimal.exec(String(percent))!;
  const places = fraction.length + 2 - Number(exponent);
  const numerator = BigInt(base) * BigInt(`${sign}${whole}${fraction}`) * 10n ** BigInt(Math.max(0, -places));
  const denominator = 10n ** BigInt(Math.max(0, places));
  const shifted = numerator + denominator / 2n;
  return Number((shifted < 0n ? shifted - denominator + 1n : shifted) / denominator);
}
export function offerTotals(offer: Row, digits = 2) {
  const base = minorUnits(offer.base, digits);
  const annualMinor = base + bonusMinorUnits(base, offer.bonus) + minorUnits(offer.equity, digits);
  const scale = 10 ** digits;
  return { annual: annualMinor / scale, firstYear: (annualMinor + minorUnits(offer.signOn, digits)) / scale, annualMinor };
}
