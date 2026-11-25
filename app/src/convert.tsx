import { useState } from 'react';
import { Draft } from './ai';
import { offerTotals, value } from './data';
import { CopyText, Fields, LongText, Panel, type Field } from './ui';
import { Records, relationField, useWorkspace } from './workspace';

export const money = (amount: number, currency: string) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount); }
  catch { return `${currency} ${amount.toLocaleString()}`.trim(); }
};
const name: Field = { key: 'name', label: 'Name' };
const notes: Field = { key: 'notes', label: 'Notes', type: 'long' };

export function Convert() {
  const { data } = useWorkspace();
  const currency = value(data.settings, 'currency') || 'USD';
  const [roleId, setRole] = useState(''), [question, setQuestion] = useState(''), [answer, setAnswer] = useState('');
  const roleFacts = (id: unknown) => id ? data.roles.find(row => row.id === id) : undefined;
  const stories = data.stories.map(({ name, themes, story }) => ({ name, themes, story }));
  const roleField = relationField(data, 'roles', 'roleId', 'Role', 'title');
  return <>
    <Panel title="Interview rounds">
      <Records list="interviews" label="interview round"
        fields={[{ key: 'name', label: 'Round name' }, roleField, { key: 'date', label: 'Date', type: 'date' }, { key: 'people', label: 'Interviewers' },
          { key: 'context', label: 'Prep context', type: 'long' }, { key: 'prep', label: 'Prep memo', type: 'long' },
          { key: 'debrief', label: 'Debrief', type: 'long' }, { key: 'thanks', label: 'Thank-you note', type: 'long' }, { key: 'plan', label: '30-60-90 day plan', type: 'long' }]}
        after={(row, edit) => {
          const facts = { role: roleFacts(row.roleId), round: row.name, people: row.people, context: row.context };
          return <>
            <Draft task="prep" label="AI prep memo" facts={{ ...facts, stories }} onUse={prep => edit({ prep })} />
            <Draft task="thanks" label="AI thank-you note" facts={{ ...facts, debrief: row.debrief }} onUse={thanks => edit({ thanks })} />
            {row.thanks && <CopyText text={value(row, 'thanks')} />}
            <Draft task="plan" label="AI 30-60-90 day plan" facts={{ ...facts, debrief: row.debrief, stories }} onUse={plan => edit({ plan })} />
          </>;
        }} />
    </Panel>
    <Panel title="Story bank" help="Save evidence you can reuse. Add comma-separated theme tags.">
      <Records list="stories" label="story" fields={[{ key: 'name', label: 'Story title' }, { key: 'themes', label: 'Theme tags' }, { key: 'story', label: 'Situation, action and result', type: 'long' }]} />
    </Panel>
    <Panel title="Mock interview">
      <Fields row={{ roleId }} fields={[roleField]} edit={(_, val) => setRole(val)} />
      <Draft task="mockQuestion" label="AI interview question" facts={{ role: roleFacts(roleId), themes: stories.map(story => story.themes) }} onUse={setQuestion} />
      <LongText label="Practice question" text={question} onChange={setQuestion} />
      <LongText label="Practice answer" text={answer} onChange={setAnswer} />
      <Draft task="mockFeedback" label="AI feedback" facts={{ role: roleFacts(roleId), question, answer }} />
    </Panel>
    <Panel title="Compare offers" help={`Annual: base + target bonus + yearly equity. First year adds sign-on. Guardrails: floor ${money(Number(data.settings.floor) || 0, currency)} · target ${money(Number(data.settings.compTarget) || 0, currency)}.`}>
      {data.offers.length > 0 && <div className="comparison">{data.offers.map((offer, index) => {
        const { annual, firstYear } = offerTotals(offer);
        const floor = Number(data.settings.floor) || 0, target = Number(data.settings.compTarget) || 0;
        return <div key={index} className="counter"><strong>{value(offer, 'name') || 'Untitled offer'}</strong>
          <span>Annual: {money(annual, currency)}</span><span>First year: {money(firstYear, currency)}</span>
          <small>{target > 0 && annual >= target ? 'Meets target' : floor > 0 && annual < floor ? 'Below floor' : floor > 0 && annual >= floor ? 'Meets floor' : 'No floor set'}</small></div>;
      })}</div>}
      <Records list="offers" label="offer" fields={[{ key: 'name', label: 'Offer name' }, roleField,
        ...([['base', 'Base'], ['bonus', 'Bonus %'], ['equity', 'Equity per year'], ['signOn', 'Sign-on']] as const).map(([key, label]) => ({ key, label, type: 'number' as const, min: 0, step: 0.01 })), notes]}
        after={row => <Draft task="negotiation" label="AI negotiation plan" facts={{ companyOrOffer: row.name, currency, base: row.base, bonusPercent: row.bonus, equityPerYear: row.equity, signOn: row.signOn, floor: data.settings.floor, target: data.settings.compTarget }} />} />
    </Panel>
    <Panel title="References tracker">
      <Records list="refs" label="reference" initial={{ status: 'Not asked' }}
        fields={[name, roleField, { key: 'relationship', label: 'Relationship' }, { key: 'status', label: 'Status', options: ['Not asked', 'Asked', 'Agreed', 'Briefed', 'Complete'] }, notes, { key: 'brief', label: 'Reference brief', type: 'long' }]}
        after={(row, edit) => <Draft task="reference" label="AI reference brief" facts={{ name: row.name, relationship: row.relationship, notes: row.notes, role: roleFacts(row.roleId) }} onUse={brief => edit({ brief })} />} />
    </Panel>
  </>;
}
