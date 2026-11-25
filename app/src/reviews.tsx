import { inWeek, localDate, value, weekStart, type Row } from './data';
import { pillars, relationship, scriptNames, scripts, stages } from './search';
import { Empty, Panel, type Field } from './ui';
import { Records, useWorkspace } from './workspace';

const notes: Field = { key: 'notes', label: 'Notes', type: 'long' };
const month = () => localDate().slice(0, 7);
const sent = (row: Row) => ['Sent', 'Replied'].includes(value(row, 'status'));
function MonthlyReview({ track }: { track: 'Search' | 'Board' }) {
  return <Panel title={`${track} monthly review`}>
    <Records list="weeks" label="monthly review" titleKey="month" initial={{ track, kind: 'Monthly', month: month() }}
      filter={row => row.kind === 'Monthly' && row.track === track}
      fields={[{ key: 'month', label: 'Month', type: 'month' }, { key: 'progress', label: 'Progress', type: 'long' },
        { key: 'changes', label: 'Changes for next month', type: 'long' }]} />
  </Panel>;
}

export function ThisWeek() {
  const { data } = useWorkspace();
  const currentWeek = weekStart(), today = localDate();
  const metrics = [
    { label: 'Outreach touches', total: data.outreach.filter(row => sent(row) && inWeek(value(row, 'sentOn'))).length, goal: Number(data.settings.touchGoal ?? 10) },
    { label: 'Posts', total: data.posts.filter(row => row.status === 'Posted' && inWeek(value(row, 'postedOn'))).length, goal: Number(data.settings.postGoal ?? 3) },
    { label: 'Engage minutes', total: data.engage.filter(row => inWeek(value(row, 'date'))).reduce((total, row) => total + (Number(row.minutes) || 0), 0), goal: Number(data.settings.engageGoal ?? 60) },
  ];
  const due = [
    ...data.roles.filter(row => row.due && value(row, 'due') <= today).map(row => `${value(row, 'title') || 'Role'}: ${value(row, 'next') || 'Review next step'} (${value(row, 'due')})`),
    ...data.outreach.filter(row => row.status === 'Sent' && row.followUp && value(row, 'followUp') <= today).map(row => `Follow up: ${value(row, 'name') || 'Outreach contact'} (${value(row, 'followUp')})`),
  ];
  return <>
    <Panel title="Weekly cadence" help={`Week of ${currentWeek} · Goals are adjustable in Setup.`}>
      <div className="metrics">{metrics.map(({ label, total, goal }) => <div className="metric" key={label}>
        <label><span>{label}</span><strong>{total} / {goal}</strong><progress value={total} max={Math.max(1, goal)} /></label>
      </div>)}</div>
    </Panel>
    <Panel title="Next moves" help="Tap to add a task and assign it to Niall or his assistant.">
      <div className="two-up">{['Niall', 'Assistant'].map(owner => <section key={owner}><h3>{owner}</h3>
        <Records list="weeks" label={`move for ${owner}`} titleKey="task" initial={{ kind: 'Move', owner, week: currentWeek, status: 'Next' }}
          filter={row => row.kind === 'Move' && row.owner === owner && (row.week === currentWeek || row.status !== 'Done')}
          fields={[{ key: 'task', label: 'Next move' }, { key: 'status', label: 'Status', options: ['Next', 'Doing', 'Done'] }, { key: 'due', label: 'Due date', type: 'date' }, notes]} />
      </section>)}</div>
    </Panel>
    <Panel title="Due now">{due.length ? <ul>{due.map((item, i) => <li key={i}>{item}</li>)}</ul> : <Empty>No role actions or outreach follow-ups are due.</Empty>}</Panel>
    <MonthlyReview track="Search" />
  </>;
}

export function Board() {
  return <>
    <Panel title="Board and advisory pipeline">
      <Records list="board" label="board lead" initial={{ status: 'Identified', type: 'Board' }}
        fields={[{ key: 'name', label: 'Organization / lead' }, { key: 'type', label: 'Type', options: ['Board', 'Advisory'] },
          { key: 'status', label: 'Stage', options: ['Identified', 'Researching', 'In conversation', 'Diligence', 'Appointed', 'Closed'] },
          { key: 'contact', label: 'Contact' }, { key: 'next', label: 'Next step' }, { key: 'due', label: 'Due date', type: 'date' }, notes]} />
    </Panel>
    <MonthlyReview track="Board" />
  </>;
}

export function Insights() {
  const { data } = useWorkspace();
  const sources = [...new Set(data.roles.map(row => value(row, 'source') || 'Not recorded'))];
  const interviewReached = (row: Row) => row.reachedInterview === true || ['Interviewing', 'Offer'].includes(value(row, 'stage')) || Boolean(row.id && data.interviews.some(interview => interview.roleId === row.id));
  function replyRates(groups: string[], field: string, labels = groups) {
    return <dl className="stats">{groups.map((group, i) => {
      const matching = data.outreach.filter(row => row[field] === group && sent(row));
      const replies = matching.filter(row => row.status === 'Replied').length;
      return <div key={group}><dt>{labels[i]}</dt><dd>{matching.length ? `${Math.round(replies / matching.length * 100)}% (${replies}/${matching.length})` : 'No sends'}</dd></div>;
    })}</dl>;
  }
  return <div className="two-up">
    <Panel title="Roles by stage"><dl className="stats">{stages.map(stage => <div key={stage}><dt>{stage}</dt><dd>{data.roles.filter(row => (stages.includes(value(row, 'stage')) ? row.stage : 'Spotted') === stage).length}</dd></div>)}</dl></Panel>
    <Panel title="Role sources and interviews">{sources.length ? <dl className="stats">{sources.map(source => {
      const roles = data.roles.filter(row => (value(row, 'source') || 'Not recorded') === source);
      return <div key={source}><dt>{source}</dt><dd>{roles.length} roles · {roles.filter(interviewReached).length} interviewed</dd></div>;
    })}</dl> : <Empty>No roles recorded yet.</Empty>}</Panel>
    <Panel title="Reply rate by script">{replyRates(scripts, 'script', scriptNames)}</Panel>
    <Panel title="Reply rate by relationship">{replyRates(relationship, 'relationship')}</Panel>
    <Panel title="Posts by pillar"><dl className="stats">{pillars.map(pillar => <div key={pillar}><dt>{pillar}</dt><dd>{data.posts.filter(row => row.pillar === pillar && row.status === 'Posted').length}</dd></div>)}</dl></Panel>
  </div>;
}
