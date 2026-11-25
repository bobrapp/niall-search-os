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
export function importBackup(text: string): Backup {
  const data: unknown = JSON.parse(text);
  if (!isRecord(data) || !isRecord(data.settings) || collections.some(key => {
    const items = data[key];
    return !Array.isArray(items) || !items.every(isRecord);
  })) throw new Error('Choose a backup with settings and all 13 data lists.');
  return data as Backup;
}
export const exportBackup = (data: Backup) => JSON.stringify(data, null, 2);
export function removeExamples(data: Backup): Backup {
  const next = structuredClone(data);
  for (const key of collections) next[key] = next[key].filter(row => row.example !== true);
  if (Array.isArray(next.settings.tools)) next.settings.tools = next.settings.tools.filter(row => !isRecord(row) || row.example !== true);
  return next;
}
export const value = (row: Row, key: string) => String(row[key] ?? '');
export const newRow = (fields: Row = {}): Row => ({ ...fields, id: crypto.randomUUID() });
export const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export function weekStart(date = new Date()) {
  const day = new Date(date);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return localDate(day);
}
export const inWeek = (date: string, now = new Date()) => date >= weekStart(now) && date <= localDate(now);
export function offerTotals(offer: Row) {
  const num = (key: string) => Number(offer[key]) || 0;
  const annual = num('base') * (1 + num('bonus') / 100) + num('equity');
  return { annual, firstYear: annual + num('signOn') };
}
