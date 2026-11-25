import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { LongText, Panel } from './ui';

const unavailable = 'AI proxy unavailable. You can still work manually.';
const enterCode = 'Enter the AI access code in Setup to enable drafting.';
const invalidCode = 'AI access code rejected. Enter a valid access code in Setup.';
const accessCodeKey = 'niall-search-os.ai-access-code';
const AIContext = createContext({
  enabled: false, reason: unavailable, accessCode: '',
  saveAccessCode: (_code: string): boolean => false, rejectAccessCode: (_code: string) => {},
});
export function AIProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState({ enabled: false, accessCodeRequired: false, reason: 'Checking AI availability…' });
  const [access, setAccess] = useState(() => {
    let code = '';
    try { code = localStorage.getItem(accessCodeKey) ?? ''; } catch {}
    return { code, rejected: false };
  });
  useEffect(() => {
    let controller: AbortController;
    const check = () => {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      void fetch('/api/ai', { cache: 'no-store', signal }).then(async response => {
        if (!response.ok) throw new Error();
        const result = await response.json();
        if (!signal.aborted) setStatus({ enabled: result.enabled === true, accessCodeRequired: result.accessCodeRequired === true, reason: result.reason || unavailable });
      }).catch(() => { if (!signal.aborted) setStatus({ enabled: false, accessCodeRequired: false, reason: unavailable }); });
    };
    const offline = () => { controller?.abort(); setStatus({ enabled: false, accessCodeRequired: false, reason: 'AI is off while offline. Your workspace still works.' }); };
    if (navigator.onLine) check(); else offline();
    window.addEventListener('online', check); window.addEventListener('offline', offline);
    return () => { controller?.abort(); window.removeEventListener('online', check); window.removeEventListener('offline', offline); };
  }, []);
  function saveAccessCode(input: string) {
    const code = input.trim();
    setAccess({ code, rejected: false });
    try {
      if (code) localStorage.setItem(accessCodeKey, code);
      else localStorage.removeItem(accessCodeKey);
      return true;
    } catch { return false; }
  }
  function rejectAccessCode(code: string) {
    setAccess(current => current.code === code ? { ...current, rejected: true } : current);
  }
  const codeReason = access.rejected ? invalidCode : status.accessCodeRequired && !access.code ? enterCode : '';
  const enabled = status.enabled && !codeReason;
  return <AIContext.Provider value={{ enabled, reason: status.enabled ? codeReason : status.reason, accessCode: access.code, saveAccessCode, rejectAccessCode }}>{children}</AIContext.Provider>;
}
export function AIStatus() {
  const status = useContext(AIContext);
  return <small>{status.enabled ? 'AI available · only selected drafting facts are sent to Anthropic' : status.reason}</small>;
}
export function AISetup() {
  const { accessCode, saveAccessCode } = useContext(AIContext);
  const id = useId();
  const [input, setInput] = useState(accessCode), [show, setShow] = useState(false), [notice, setNotice] = useState('');
  return <Panel title="AI drafting access" help="Enter the code provided by the owner. It is stored only in this browser, not in backups. Leave it blank and save to remove it.">
    <form onSubmit={event => {
      event.preventDefault();
      const code = input.trim();
      const saved = saveAccessCode(code);
      setInput(code); setShow(false);
      setNotice(saved ? (code ? 'AI access code saved on this device.' : 'AI access code removed.') : 'Browser storage is unavailable. The code will not persist after closing this page.');
    }}>
      <label className="field" htmlFor={id}>AI access code
        <input id={id} type={show ? 'text' : 'password'} autoComplete="off" autoCapitalize="none" spellCheck={false} value={input} onChange={event => { setInput(event.target.value); setNotice(''); }} />
      </label>
      <div className="actions">
        <button type="button" onClick={() => setShow(!show)}>{show ? 'Hide AI access code' : 'Show AI access code'}</button>
        <button type="submit">Save AI access code</button>
      </div>
      {notice && <p role="status">{notice}</p>}
    </form>
  </Panel>;
}
export function Draft({ task, label, facts, onUse }: { task: string; label: string; facts: unknown; onUse?: (draft: string) => void }) {
  const status = useContext(AIContext);
  const active = useRef<AbortController | null>(null);
  const [running, setRunning] = useState(false), [attempted, setAttempted] = useState(false), [draft, setDraft] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => () => active.current?.abort(), []);
  async function run() {
    if (active.current || !status.enabled) return;
    const controller = new AbortController(); active.current = controller;
    setAttempted(true); setRunning(true); setNotice('');
    try {
      const response = await fetch('/api/ai', {
        method: 'POST', headers: {
          'Content-Type': 'application/json',
          'X-AI-Access-Code-Base64': btoa(Array.from(new TextEncoder().encode(status.accessCode), byte => String.fromCharCode(byte)).join('')),
        },
        signal: controller.signal, body: JSON.stringify({ task, facts: JSON.stringify(facts) }),
      });
      if (response.status === 401) {
        if (!controller.signal.aborted) status.rejectAccessCode(status.accessCode);
        return;
      }
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
