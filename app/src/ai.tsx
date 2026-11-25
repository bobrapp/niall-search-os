import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { LongText } from './ui';

const unavailable = 'AI proxy unavailable. You can still work manually.';
const AIContext = createContext({ enabled: false, reason: unavailable });
export function AIProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState({ enabled: false, reason: 'Checking AI availability…' });
  useEffect(() => {
    let controller: AbortController;
    const check = () => {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      void fetch('/api/ai', { cache: 'no-store', signal }).then(async response => {
        if (!response.ok) throw new Error();
        const result = await response.json();
        if (!signal.aborted) setStatus({ enabled: result.enabled === true, reason: result.reason || unavailable });
      }).catch(() => { if (!signal.aborted) setStatus({ enabled: false, reason: unavailable }); });
    };
    const offline = () => { controller?.abort(); setStatus({ enabled: false, reason: 'AI is off while offline. Your workspace still works.' }); };
    if (navigator.onLine) check(); else offline();
    window.addEventListener('online', check); window.addEventListener('offline', offline);
    return () => { controller?.abort(); window.removeEventListener('online', check); window.removeEventListener('offline', offline); };
  }, []);
  return <AIContext.Provider value={status}>{children}</AIContext.Provider>;
}
export function AIStatus() {
  const status = useContext(AIContext);
  return <small>{status.enabled ? 'AI available · only selected drafting facts are sent to Anthropic' : status.reason}</small>;
}
export function Draft({ task, label, facts, onUse }: { task: string; label: string; facts: unknown; onUse?: (draft: string) => void }) {
  const status = useContext(AIContext);
  const active = useRef<AbortController | null>(null);
  const [running, setRunning] = useState(false), [attempted, setAttempted] = useState(false), [draft, setDraft] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => () => active.current?.abort(), []);
  async function run() {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    setAttempted(true); setRunning(true); setNotice('');
    try {
      const response = await fetch('/api/ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: controller.signal, body: JSON.stringify({ task, facts: JSON.stringify(facts) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Draft failed.');
      if (!controller.signal.aborted) setDraft(result.draft);
    } catch (error) {
      if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : 'Draft failed. Please retry.');
    } finally {
      if (active.current === controller) { active.current = null; setRunning(false); }
    }
  }
  function stop() {
    active.current?.abort(); active.current = null; setRunning(false); setNotice('Draft stopped. You can retry.');
  }
  return <div className="draft">
    <div className="actions">
      <button type="button" disabled={!status.enabled || running} onClick={run}>{label}</button>
      {running && <button type="button" onClick={stop}>Stop</button>}
      {attempted && !running && <button type="button" disabled={!status.enabled} onClick={run}>Retry {label}</button>}
    </div>
    {!status.enabled && <small>{status.reason}</small>}
    {running && <small role="status">Drafting…</small>}
    {notice && <small role="status">{notice}</small>}
    {draft && <><LongText label={`${label} result`} text={draft} onChange={setDraft} />{onUse && <button onClick={() => onUse(draft)}>Use draft</button>}</>}
  </div>;
}
