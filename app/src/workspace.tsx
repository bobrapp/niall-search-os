import { createContext, useContext, useState, type ReactNode } from 'react';
import { newRow, value, type Backup, type Collection, type Row } from './data';
import { Empty, Fields, type Field } from './ui';

type Workspace = { data: Backup; update: (apply: (old: Backup) => Backup) => void };
export const WorkspaceContext = createContext<Workspace | null>(null);
export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('Workspace provider missing.');
  return context;
}
export type Edit = (fields: Row) => void;
export function useRecords(list: Collection) {
  const { data, update } = useWorkspace();
  const rows = data[list];
  return {
    rows,
    add: (fields: Row) => update(old => ({ ...old, [list]: [...old[list], newRow(fields)] })),
    edit: (index: number): Edit => fields => update(old => ({
      ...old, [list]: old[list].map((row, i) => i === index ? { ...row, ...fields } : row),
    })),
    remove: (index: number) => update(old => ({ ...old, [list]: old[list].filter((_, i) => i !== index) })),
  };
}
export function targetField(data: Backup): Field {
  return { key: 'targetId', label: 'Target', options: ['', ...data.targets.flatMap(row => row.id ? [[row.id, value(row, 'name')] as [string, string]] : [])] };
}
export function relationField(data: Backup, list: Collection, key: string, label: string, display: string): Field {
  return { key, label, options: ['', ...data[list].flatMap(row => row.id ? [[row.id, value(row, display) || 'Untitled'] as [string, string]] : [])] };
}
export function RecordCard({ row, fields, edit, remove, title, children, onField }: { row: Row; fields: Field[]; edit: Edit; remove: () => void; title: string; children?: ReactNode; onField?: (row: Row, key: string, text: string) => Row }) {
  const [open, setOpen] = useState(!title);
  return <article className="record"><details open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary>{title || 'New item'}{row.example === true && <small> · Example</small>}</summary>
    <Fields row={row} fields={fields} edit={(key, text) => edit(onField ? onField(row, key, text) : { [key]: text })} />
    {children}
    <button className="quiet" onClick={() => { if (window.confirm('Delete this item?')) remove(); }}>Delete item</button>
  </details></article>;
}
export function Records({ list, fields, label, titleKey = 'name', initial = {}, after, filter, onField }: {
  list: Collection; fields: Field[]; label: string; titleKey?: string; initial?: Row;
  after?: (row: Row, edit: Edit) => ReactNode; filter?: (row: Row, index: number) => boolean;
  onField?: (row: Row, key: string, text: string) => Row;
}) {
  const { rows, add, edit, remove } = useRecords(list);
  const displayed = rows.flatMap((row, index) => !filter || filter(row, index) ? [{ row, index }] : []);
  return <><button className="primary" onClick={() => add(initial)}>Add {label}</button>
    {!displayed.length && <Empty>No {label} entries yet.</Empty>}
    <div className="records">{displayed.map(({ row, index }) => <RecordCard key={row.id ?? index} row={row} fields={fields} edit={edit(index)} remove={() => remove(index)} title={value(row, titleKey)} onField={onField}>
      {after?.(row, edit(index))}
    </RecordCard>)}</div></>;
}
