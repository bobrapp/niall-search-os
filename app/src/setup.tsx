import { useState, type ChangeEvent } from 'react';
import { defaultSettings, exportBackup, importBackup, newRow, removeExamples, value, type Row } from './data';
import { exportCsv, importConnections } from './imports';
import { download, Empty, Fields, Panel, type Field } from './ui';
import { RecordCard, useWorkspace } from './workspace';

const settingsFields: Field[] = [
  { key: 'positioning', label: 'Positioning', type: 'long' }, { key: 'resume', label: 'Resume', type: 'long' },
  { key: 'scriptA', label: 'Script A · Search partner', type: 'long' }, { key: 'scriptB', label: 'Script B · Warm intro', type: 'long' }, { key: 'scriptC', label: 'Script C · Direct to CIO', type: 'long' },
];
const goalFields: Field[] = [
  { key: 'touchGoal', label: 'Weekly outreach touches', type: 'number', min: 0 },
  { key: 'postGoal', label: 'Weekly posts', type: 'number', min: 0 },
  { key: 'engageGoal', label: 'Weekly engage minutes', type: 'number', min: 0 },
  { key: 'currency', label: 'Currency (ISO code, e.g. USD)' },
  { key: 'floor', label: 'Annual comp floor', type: 'number', min: 0 },
  { key: 'compTarget', label: 'Annual comp target', type: 'number', min: 0 },
];
const contactColumns: [string, string][] = [['name', 'Name'], ['company', 'Company'], ['target', 'Target'], ['title', 'Title'], ['relationship', 'Relationship'], ['url', 'Profile URL'], ['connectedOn', 'Connected On'], ['notes', 'Notes']];
const outreachColumns: [string, string][] = [['name', 'Name'], ['target', 'Target'], ['script', 'Script'], ['relationship', 'Relationship'], ['status', 'Status'], ['body', 'Draft'], ['sentOn', 'Sent'], ['followUp', 'Follow-up'], ['repliedOn', 'Replied']];
export function Setup() {
  const { data, update } = useWorkspace();
  const [notice, setNotice] = useState('');
  const settings = { ...defaultSettings, ...data.settings };
  const tools: Row[] = Array.isArray(settings.tools) ? settings.tools : [];
  const set = (key: string, text: string) => update(old => ({ ...old, settings: { ...old.settings, [key]: text } }));
  const targetNames = new Map(data.targets.map(row => [row.id, value(row, 'name')]));
  async function readFile(event: ChangeEvent<HTMLInputElement>, kind: 'backup' | 'connections') {
    const input = event.currentTarget, selected = input.files?.[0];
    input.value = '';
    if (!selected) return;
    try {
      const text = await selected.text();
      if (kind === 'backup') {
        const backup = importBackup(text);
        if (!window.confirm('Replace this workspace with the backup? Export the current workspace first if you want to keep it.')) return;
        update(() => backup); setNotice('Backup imported.');
      } else {
        const imported = importConnections(text, data.targets);
        const matched = imported.filter(row => row.targetId).length;
        update(old => ({ ...old, contacts: [...old.contacts, ...imported] }));
        setNotice(`Added ${imported.length} contacts; ${matched} matched to targets. Email addresses were not imported.`);
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not read file.'); }
  }
  function saveCsv(kind: 'outreach' | 'contacts') {
    const rows = data[kind].map(row => ({
      ...row, target: row.targetId ? targetNames.get(value(row, 'targetId')) : '',
      name: row.name || (row.contactId ? data.contacts.find(contact => contact.id === row.contactId)?.name : ''),
    }));
    download(`${kind}.csv`, exportCsv(rows, kind === 'contacts' ? contactColumns : outreachColumns), 'text/csv;charset=utf-8');
  }
  function editTools(transform: (old: Row[]) => Row[]) {
    update(old => ({ ...old, settings: { ...old.settings, tools: transform(Array.isArray(old.settings.tools) ? old.settings.tools : []) } }));
  }
  const toolFields: Field[] = [
    { key: 'name', label: 'Tool' }, { key: 'cost', label: 'Budgeted cost', type: 'number', min: 0, step: 0.01 },
    { key: 'cadence', label: 'Billing cadence', options: ['', 'Monthly', 'Annual', 'One-time', 'Free'] },
    { key: 'status', label: 'Status', options: ['', 'Considering', 'Approved', 'Active', 'Cancelled'] },
    { key: 'notes', label: 'Budget notes', type: 'long' },
  ];
  return <>
    <Panel title="Data and privacy" help="Workspace records stay in this browser. Exports contain your local data; store them privately. Import from a file to move data between devices.">
      <div className="actions">
        <button className="primary" onClick={() => download('niall-search-os-backup.json', exportBackup(data), 'application/json')}>Export JSON backup</button>
        <button onClick={() => saveCsv('outreach')}>Export outreach CSV</button><button onClick={() => saveCsv('contacts')}>Export contacts CSV</button>
        <button onClick={() => { if (window.confirm('Remove rows marked as example data?')) { update(removeExamples); setNotice('Example data removed.'); } }}>Remove example data</button>
      </div>
      <div className="fields">
        <label className="field">Import JSON backup<input type="file" accept=".json,application/json" onChange={e => void readFile(e, 'backup')} /></label>
        <label className="field">Import LinkedIn connections CSV<input type="file" accept=".csv,text/csv" onChange={e => void readFile(e, 'connections')} /></label>
      </div>{notice && <p role="status">{notice}</p>}
    </Panel>
    <Panel title="Positioning and scripts"><Fields row={settings} fields={settingsFields} edit={set} /></Panel>
    <Panel title="Cadence and compensation"><Fields row={settings} fields={goalFields} edit={set} /></Panel>
    <Panel title="Tool budget" help="Planning only. This workspace never purchases or subscribes to tools.">
      <button className="primary" onClick={() => editTools(old => [...old, newRow()])}>Add tool</button>
      {!tools.length ? <Empty>No budgeted tools yet.</Empty> : <>
        <table><thead><tr><th>Tool</th><th>Budget</th><th>Cadence</th><th>Status</th></tr></thead>
          <tbody>{tools.map((row, i) => <tr key={i}><td>{value(row, 'name') || 'Untitled'}</td><td>{value(row, 'cost') || '—'} {value(settings, 'currency')}</td><td>{value(row, 'cadence') || '—'}</td><td>{value(row, 'status') || '—'}</td></tr>)}</tbody>
        </table>
        <div className="records">{tools.map((row, index) => <RecordCard key={row.id ?? index} row={row} fields={toolFields} title={value(row, 'name')}
          edit={fields => editTools(old => old.map((item, i) => i === index ? { ...item, ...fields } : item))}
          remove={() => editTools(old => old.filter((_, i) => i !== index))} />)}</div>
      </>}
    </Panel>
  </>;
}
