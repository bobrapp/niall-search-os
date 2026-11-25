import { useState } from 'react';
import { Draft } from './ai';
import { defaultSettings, localDate, value, type Row } from './data';
import { parseDigest } from './imports';
import { keywordMatch } from './keywords';
import { CopyText, Empty, Fields, LongText, Panel, type Field } from './ui';
import { RecordCard, Records, relationField, targetField, useRecords, useWorkspace } from './workspace';

export const stages = ['Spotted', 'Researching', 'In outreach', 'Interviewing', 'Offer'];
export const pillars = ['Money', 'Governance', 'Craft'];
export const relationship = ['Warm', 'Cold', 'Search firms'];
export const scripts = ['A', 'B', 'C'];
export const scriptNames = ['A · Search partner', 'B · Warm intro', 'C · Direct to CIO'];
const notes: Field = { key: 'notes', label: 'Notes', type: 'long' };
const company: Field = { key: 'company', label: 'Company' };
const name: Field = { key: 'name', label: 'Name' };

export function MapScreen() {
  const { data } = useWorkspace();
  const [target, setTarget] = useState('');
  const selected = data.targets.find(row => row.id && row.id === target);
  return <>
    <Panel title="Target companies" help="Tap a target to see its contacts. Warm paths count contacts marked Warm.">
      <div className="target-grid">{data.targets.map((row, index) => {
        const warm = row.id ? data.contacts.filter(contact => contact.targetId === row.id && contact.relationship === 'Warm').length : 0;
        return <button key={index} aria-pressed={Boolean(row.id && target === row.id)} disabled={!row.id} onClick={() => setTarget(target === row.id ? '' : row.id!)}>{value(row, 'name') || 'Unnamed target'} <small>{warm} warm {warm === 1 ? 'path' : 'paths'}</small></button>;
      })}</div>
      <details className="subsection"><summary>Edit targets and aliases</summary>
        <Records list="targets" label="target" fields={[name, { key: 'aliases', label: 'Aliases (comma-separated)' }, notes]} />
      </details>
    </Panel>
    <Panel title={selected ? `${value(selected, 'name')} contacts` : 'All contacts'}>
      {selected && <button onClick={() => setTarget('')}>Show all contacts</button>}
      <Records list="contacts" label="contact" initial={{ relationship: 'Warm', targetId: selected?.id ?? '' }}
        filter={row => !selected || row.targetId === selected.id}
        fields={[name, company, targetField(data), { key: 'title', label: 'Title' }, { key: 'relationship', label: 'Relationship', options: ['', 'Warm', 'Cold'] }, { key: 'url', label: 'Profile URL' }, notes]} />
    </Panel>
  </>;
}

export function Signal() {
  const { data, update } = useWorkspace();
  const { rows, add, edit, remove } = useRecords('roles');
  const [kanban, setKanban] = useState(true), [digest, setDigest] = useState(''), [notice, setNotice] = useState('');
  const [roleId, setRoleId] = useState(''), [jd, setJd] = useState('');
  const role = rows.find(row => row.id === roleId);
  const description = role ? value(role, 'description') : jd;
  const resume = value(data.settings, 'resume');
  const match = keywordMatch(description, resume);
  const roleFields: Field[] = [
    { key: 'title', label: 'Role title' }, company, targetField(data), { key: 'stage', label: 'Stage', options: stages },
    { key: 'source', label: 'Source' }, { key: 'url', label: 'Posting URL' }, { key: 'location', label: 'Location' },
    { key: 'fit', label: 'Fit score (out of 10)', type: 'number', min: 0, max: 10, step: 0.1 }, { key: 'next', label: 'Next step' },
    { key: 'due', label: 'Due date', type: 'date' }, { key: 'description', label: 'Job description', type: 'long' }, notes,
  ];
  function importDigest() {
    const parsed = parseDigest(digest, data.targets), seen = new Set(rows.map(row => value(row, 'url')).filter(Boolean));
    const fresh = parsed.filter(row => {
      const url = value(row, 'url');
      if (url && seen.has(url)) return false;
      if (url) seen.add(url);
      return true;
    });
    if (fresh.length) { update(old => ({ ...old, roles: [...old.roles, ...fresh] })); setDigest(''); }
    setNotice(parsed.length ? `Added ${fresh.length} roles. Skipped ${parsed.length - fresh.length} duplicate URLs.` : 'No postings found in the pasted scout digest.');
  }
  const cards = (filter: (row: Row) => boolean) => rows.map((row, index) => filter(row) &&
    <RecordCard key={row.id ?? index} row={row} fields={roleFields} title={value(row, 'title')} edit={edit(index)} remove={() => remove(index)}
      onField={(_, key, text) => key === 'stage' && ['Interviewing', 'Offer'].includes(text) ? { stage: text, reachedInterview: true } : { [key]: text }} />);
  return <>
    <Panel title="Role pipeline">
      <div className="actions"><button className="primary" onClick={() => add({ stage: 'Spotted' })}>Add role</button>
        <button aria-pressed={kanban} onClick={() => setKanban(true)}>Board</button><button aria-pressed={!kanban} onClick={() => setKanban(false)}>List</button></div>
      {kanban ? <div className="kanban">{stages.map(stage => {
        const filter = (row: Row) => (stages.includes(value(row, 'stage')) ? value(row, 'stage') : 'Spotted') === stage;
        return <section key={stage}><h3>{stage} <span>{rows.filter(filter).length}</span></h3>{cards(filter)}</section>;
      })}</div> : <div className="records">{rows.length ? cards(() => true) : <Empty>No roles yet.</Empty>}</div>}
    </Panel>
    <Panel title="Import scout digest" help="Paste the plain-text daily digest. Entries land in Spotted.">
      <LongText label="Scout digest email" text={digest} onChange={setDigest} /><button disabled={!digest.trim()} onClick={importDigest}>Import digest</button>
      {notice && <p role="status">{notice}</p>}
    </Panel>
    <Panel title="Resume match and tailoring" help="Keyword matching runs on this device. Save or update your resume in Setup.">
      <Fields row={{ roleId }} fields={[relationField(data, 'roles', 'roleId', 'Role', 'title')]} edit={(_, text) => setRoleId(text)} />
      <LongText label="Description to match" text={description} onChange={text => role ? edit(rows.indexOf(role))({ description: text }) : setJd(text)} />
      <p><strong>{match.score}% match</strong>{!resume && ' · No resume saved'}</p>
      <p><strong>Hits:</strong> {match.hits.join(', ') || '—'}<br /><strong>Missing:</strong> {match.missing.join(', ') || '—'}</p>
      {([['gaps', 'AI gap notes'], ['bullets', 'AI tailored bullets'], ['cover', 'AI cover letter']] as const).map(([task, label]) =>
        <Draft key={task} task={task} label={label} facts={{ description, resume, positioning: data.settings.positioning }} />)}
    </Panel>
  </>;
}

export function Engage() {
  const { data, update } = useWorkspace();
  const logs = useRecords('engage');
  const today = localDate();
  const [recent, setRecent] = useState('');
  const [headline, about] = [value(data.settings, 'headline'), value(data.settings, 'about')];
  const setSetting = (key: string, text: string) => update(old => ({ ...old, settings: { ...old.settings, [key]: text } }));
  return <>
    <Panel title="Three weekly posts" help="Draft, approve and copy. Post manually, then log it here.">
      <Records list="posts" label="post" titleKey="title" initial={{ pillar: 'Money', status: 'Draft' }}
        onField={(row, key, text) => row.status === 'Approved' ? { [key]: text, status: 'Draft' } : { [key]: text }}
        fields={[{ key: 'title', label: 'Post title' }, { key: 'pillar', label: 'Pillar', options: pillars }, { key: 'body', label: 'Post text', type: 'long' }]}
        after={(row, edit) => <>
          <Draft task="post" label="AI post draft" facts={{ pillar: row.pillar, topic: row.title, suppliedDraft: row.body, positioning: data.settings.positioning }} onUse={row.status === 'Posted' ? undefined : draft => edit({ body: draft, status: 'Draft', postedOn: '' })} />
          <div className="actions"><span className="tag">{value(row, 'status') || 'Draft'}</span>
            <button disabled={!value(row, 'body').trim() || row.status === 'Approved' || row.status === 'Posted'} onClick={() => edit({ status: 'Approved' })}>Approve post</button>
            {['Approved', 'Posted'].includes(value(row, 'status')) && <CopyText text={value(row, 'body')} />}
            <button disabled={row.status !== 'Approved'} onClick={() => edit({ status: 'Posted', postedOn: today })}>Mark posted</button>
            {['Approved', 'Posted'].includes(value(row, 'status')) && <button onClick={() => edit({ status: 'Draft', postedOn: '' })}>Back to draft</button>}
          </div>{value(row, 'postedOn') && <p className="muted">Posted {value(row, 'postedOn')}</p>}
        </>} />
    </Panel>
    <Panel title="Target comments" help="Tap after commenting manually. Record minutes separately to track weekly effort.">
      <div className="target-grid">{data.targets.map((row, index) => {
        const count = row.id ? logs.rows.filter(log => log.targetId === row.id).reduce((total, log) => total + (Number(log.comments) || 0), 0) : 0;
        const target = value(row, 'name');
        return <div className="counter" key={index}><strong>{target}</strong><span>{count} comments</span>
          <button disabled={!row.id} aria-label={`Log comment for ${target}`} onClick={() => { logs.add({ targetId: row.id, date: today, comments: 1 }); setRecent(`Logged a comment for ${target}.`); }}>+ Comment</button></div>;
      })}</div>
      {recent && <p role="status">{recent}</p>}
      <Records list="engage" label="engagement log" titleKey="date" initial={{ date: today }}
        fields={[targetField(data), { key: 'date', label: 'Date', type: 'date' }, { key: 'minutes', label: 'Minutes', type: 'number', min: 0 }, { key: 'comments', label: 'Comments', type: 'number', min: 0 }, notes]} />
    </Panel>
    <Panel title="LinkedIn headline and About review">
      <Fields row={data.settings} fields={[{ key: 'headline', label: 'Headline' }, { key: 'about', label: 'About', type: 'long' }]} edit={setSetting} />
      <Draft task="profile" label="AI profile review" facts={{ headline, about, positioning: data.settings.positioning, resume: data.settings.resume }} />
    </Panel>
  </>;
}

export function Outreach() {
  const { data } = useWorkspace();
  return <>
    <Panel title="Outreach log" help="The workspace never sends anything. Copy approved text, send it yourself, and track the outcome here.">
      <Records list="outreach" label="outreach" initial={{ script: 'A', relationship: 'Search firms', status: 'Draft' }}
        onField={(row, key, text) => row.status === 'Approved' && key !== 'followUp' ? { [key]: text, status: 'Draft' } : { [key]: text }}
        fields={[name, targetField(data), relationField(data, 'contacts', 'contactId', 'Saved contact', 'name'), { key: 'script', label: 'Script', options: scripts.map((id, i) => [id, scriptNames[i]]) },
          { key: 'relationship', label: 'Relationship', options: relationship }, { key: 'context', label: 'Relevant facts', type: 'long' },
          { key: 'body', label: 'Message draft', type: 'long' }, { key: 'followUp', label: 'Follow-up date', type: 'date' }]}
        after={(row, edit) => {
          const scriptKey = ('script' + (value(row, 'script') || 'A')) as 'scriptA' | 'scriptB' | 'scriptC';
          const template = value(data.settings, scriptKey) || defaultSettings[scriptKey];
          const status = value(row, 'status') || 'Draft';
          const contact = data.contacts.find(contact => contact.id && contact.id === row.contactId);
          const target = data.targets.find(target => target.id && target.id === row.targetId);
          return <>
            <button disabled={!template || status !== 'Draft'} onClick={() => edit({ body: template.replaceAll('[name]', value(row, 'name') || (contact ? value(contact, 'name') : '') || '[name]') })}>Use script as draft</button>
            <Draft task="outreach" label="AI outreach draft"
              facts={{ script: template, name: row.name ?? contact?.name, company: target?.name ?? contact?.company, title: contact?.title, facts: row.context, draft: row.body, positioning: data.settings.positioning }}
              onUse={status === 'Draft' ? draft => edit({ body: draft }) : undefined} />
            <div className="actions"><span className="tag">{status}</span>
              <button disabled={status !== 'Draft' || !value(row, 'body').trim()} onClick={() => edit({ status: 'Approved' })}>Approve</button>
              {status !== 'Draft' && <CopyText text={value(row, 'body')} />}
              <button disabled={status !== 'Approved'} onClick={() => edit({ status: 'Sent', sentOn: localDate() })}>Mark sent</button>
              <button disabled={status !== 'Sent'} onClick={() => edit({ status: 'Replied', repliedOn: localDate() })}>Replied</button>
              {status === 'Approved' && <button onClick={() => edit({ status: 'Draft' })}>Back to draft</button>}
            </div>
            {value(row, 'sentOn') && <p className="muted">Sent {value(row, 'sentOn')}{row.repliedOn ? ` · Replied ${value(row, 'repliedOn')}` : ''}</p>}
          </>;
        }} />
    </Panel>
    <Panel title="Search firm tracker">
      <Records list="firms" label="search firm" initial={{ status: 'Not contacted' }}
        fields={[name, { key: 'status', label: 'Status', options: ['Not contacted', 'Researching', 'Contacted', 'In conversation', 'Paused'] },
          { key: 'partner', label: 'Partner' }, { key: 'next', label: 'Next step' }, { key: 'due', label: 'Due date', type: 'date' }, notes]} />
    </Panel>
  </>;
}
