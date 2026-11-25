import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AIProvider, AIStatus } from './ai';
import { Convert } from './convert';
import type { Backup } from './data';
import { Board, Insights, ThisWeek } from './reviews';
import { Engage, MapScreen, Outreach, Signal } from './search';
import { Setup } from './setup';
import { indexedWorkspace, WorkspaceConflict } from './storage';
import { WorkspaceContext } from './workspace';
import './styles.css';

const screens = [
  ['week', 'This week', ThisWeek], ['map', 'Map', MapScreen], ['signal', 'Signal', Signal],
  ['engage', 'Engage', Engage], ['outreach', 'Outreach', Outreach], ['convert', 'Convert', Convert],
  ['board', 'Board track', Board], ['insights', 'Insights', Insights], ['setup', 'Tools & Setup', Setup],
] as const;
const current = () => screens.find(([id]) => '#' + id === location.hash) ?? screens[0];

function App() {
  const [screen, setScreen] = useState(current);
  const [data, setData] = useState<Backup | null>(null), [error, setError] = useState('');
  const latest = useRef<Backup | null>(null), writes = useRef(Promise.resolve());
  const revision = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    void indexedWorkspace.load().then(workspace => {
      revision.current = workspace.revision;
      latest.current = workspace.data;
      setData(workspace.data);
    })
      .catch(() => setError('Local storage could not open. Check that this browser allows IndexedDB, then reload.'));
    const navigate = () => {
      setScreen(current());
      requestAnimationFrame(() => { heading.current?.focus(); window.scrollTo(0, 0); });
    };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  const update = useCallback((apply: (old: Backup) => Backup) => {
    if (!latest.current) return;
    const snapshot = apply(latest.current);
    latest.current = snapshot;
    setData(snapshot);
    writes.current = writes.current.then(async () => {
      try { revision.current = await indexedWorkspace.save(snapshot, revision.current); setError(''); }
      catch (error) {
        setError(error instanceof WorkspaceConflict
          ? 'Another tab saved changes first. Your changes in this tab are not saved. Export a backup to keep them, then reload.'
          : 'Changes could not be saved to this device. Export a backup before leaving.');
      }
    });
  }, []);
  const [id, title, Screen] = screen;
  return <AIProvider>
    <a className="skip" href="#main" onClick={event => { event.preventDefault(); heading.current?.focus(); }}>Skip to content</a>
    <header className="brand"><div className="wordmark"><span aria-hidden="true">N</span><div><strong>Niall Search OS</strong><small>Private executive workspace</small></div></div></header>
    <div className="layout">
      <nav aria-label="Workspace">{screens.map(([key, label]) => <a key={key} href={`#${key}`} aria-current={key === id ? 'page' : undefined}>{label}</a>)}</nav>
      <main id="main" tabIndex={-1}>
        <div className="intro"><p className="eyebrow">Executive search workspace</p><h1 ref={heading} tabIndex={-1}>{title}</h1><AIStatus /></div>
        {error && <p className="alert" role="alert">{error}</p>}
        {data ? <WorkspaceContext.Provider value={{ data, update }}><Screen /></WorkspaceContext.Provider> : !error && <p role="status">Opening your local workspace…</p>}
      </main>
    </div>
    <footer>Stored on this device. Nothing is sent on your behalf.</footer>
  </AIProvider>;
}
createRoot(document.getElementById('root')!).render(<App />);
