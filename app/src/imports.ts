import { newRow, value, type Row } from './data';

function parseCsv(text: string) {
  const result: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && !field) quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      result.push([...row, field]); row = []; field = '';
    } else field += char;
  }
  if (quoted) throw new Error('A CSV field has an unclosed quote.');
  if (row.length || field) result.push([...row, field]);
  return result;
}
const normalize = (text: string) => text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
export function matchTarget(company: string, targets: Row[]) {
  const name = normalize(company);
  if (!name) return undefined;
  return targets.find(target => normalize(value(target, 'name')) === name)
    ?? targets.find(target => (Array.isArray(target.aliases) ? target.aliases.map(String) : value(target, 'aliases').split(/[,;\n]/)).some(alias => normalize(alias) === name));
}
export function importConnections(text: string, targets: Row[]) {
  const rows = parseCsv(text);
  const index = rows.findIndex(row => ['first name', 'last name', 'company'].every(field => row.map(normalize).includes(field)));
  if (index < 0) throw new Error('LinkedIn CSV headers First Name, Last Name and Company were not found.');
  const headers = rows[index].map(normalize);
  return rows.slice(index + 1).flatMap(row => {
    const get = (key: string) => row[headers.indexOf(key)]?.trim() ?? '';
    const name = [get('first name'), get('last name')].filter(Boolean).join(' ');
    if (!name) return [];
    const company = get('company'), target = matchTarget(company, targets);
    return [newRow({ name, company, targetId: target ? value(target, 'id') : '', title: get('position'), url: get('url'), connectedOn: get('connected on'), relationship: 'Warm' })];
  });
}
export function exportCsv(rows: Row[], columns: [string, string][]) {
  const cell = (text: string) => '"' + (/^\s*[=+@\-]|^[\t\r\n]/.test(text) ? "'" + text : text).replaceAll('"', '""') + '"';
  return [columns.map(([, label]) => cell(label)), ...rows.map(row => columns.map(([key]) => cell(value(row, key))))].map(row => row.join(',')).join('\r\n');
}
export function parseDigest(text: string, targets: Row[]) {
  const roles: Row[] = [];
  let role: Row | undefined;
  for (const line of text.replace(/\r/g, '').split('\n')) {
    if (line.trim() === 'Sources not read this run:') break;
    const match = line.match(/^\[(\d+(?:\.\d+)?|\?)\/10\]\s+(.+)\s+-\s+(.+)$/);
    if (match) {
      const [, fit, title, company] = match;
      const target = matchTarget(company.trim(), targets);
      role = newRow({ title: title.trim(), company: company.trim(), targetId: target ? value(target, 'id') : '', fit: fit === '?' ? '' : fit, stage: 'Spotted', source: 'Scout digest' });
      roles.push(role);
    } else if (role && /^\s{2,}\S/.test(line)) {
      const field = line.trim();
      if (/^https?:\/\/\S+$/i.test(field)) role.url = field;
      else if (field.startsWith('Why: ')) role.notes = field.slice(5);
      else role.location = value(role, 'location') ? `${value(role, 'location')}\n${field}` : field;
    }
  }
  return roles;
}
