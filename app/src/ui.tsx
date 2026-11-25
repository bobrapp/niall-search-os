import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { value, type Row } from './data';

type Recognition = {
  start(): void; abort(): void; lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null; onend: (() => void) | null;
};
const speech = window as Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
const Speech = speech.SpeechRecognition ?? speech.webkitSpeechRecognition;
export function LongText({ label, text, onChange }: { label: string; text: string; onChange: (text: string) => void }) {
  const id = useId(), recognition = useRef<Recognition | null>(null);
  const [listening, setListening] = useState(false), [error, setError] = useState('');
  const latest = useRef({ text, onChange });
  latest.current = { text, onChange };
  useEffect(() => () => {
    if (recognition.current) {
      recognition.current.onend = recognition.current.onerror = recognition.current.onresult = null;
      recognition.current.abort();
    }
  }, []);
  function dictate() {
    if (recognition.current) { recognition.current.abort(); return; }
    if (!Speech) return;
    setError('');
    const instance = new Speech();
    recognition.current = instance;
    instance.lang = navigator.language;
    instance.onresult = event => {
      const transcript = Array.from(event.results, result => result[0].transcript).join(' ');
      const { text, onChange } = latest.current;
      onChange(text ? text + ' ' + transcript : transcript);
    };
    instance.onerror = () => setError('Dictation unavailable. You can still type or paste.');
    instance.onend = () => { recognition.current = null; setListening(false); };
    try { instance.start(); setListening(true); }
    catch { recognition.current = null; setError('Dictation unavailable. You can still type or paste.'); }
  }
  return <div className="field"><div className="field-label"><label htmlFor={id}>{label}</label>{Speech && <button type="button" className="mic" onClick={dictate} aria-label={`${listening ? 'Stop dictation for' : 'Dictate'} ${label}`} title="Browser speech recognition may use an online speech service">{listening ? '■' : '🎙'}</button>}</div>
    <textarea id={id} rows={3} value={text} onChange={e => onChange(e.target.value)} />{error && <small role="status">{error}</small>}
  </div>;
}
export type Field = { key: string; label: string; type?: 'long' | 'date' | 'month' | 'number'; options?: (string | [string, string])[]; min?: number; max?: number; step?: number };
export function Fields({ row, fields, edit }: { row: Row; fields: Field[]; edit: (key: string, text: string) => void }) {
  return <div className="fields">{fields.map(({ key, label, type, options, min, max, step }) => {
    const text = value(row, key);
    if (type === 'long') return <LongText key={key} label={label} text={text} onChange={v => edit(key, v)} />;
    return <label className="field" key={key}>{label}{options
      ? <select value={text} onChange={e => edit(key, e.target.value)}>{options.map(item => {
        const [val, name] = typeof item === 'string' ? [item, item || 'Not selected'] : item;
        return <option key={val} value={val}>{name}</option>;
      })}</select>
      : <input type={type ?? 'text'} value={text} min={min} max={max} step={step} onChange={e => edit(key, e.target.value)} />}</label>;
  })}</div>;
}
export function Panel({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  return <section className="panel"><h2>{title}</h2>{help && <p className="muted">{help}</p>}{children}</section>;
}
export function Empty({ children }: { children: ReactNode }) { return <p className="empty">{children}</p>; }
export function CopyText({ text }: { text: string }) {
  const [notice, setNotice] = useState('');
  return <><button disabled={!text.trim()} onClick={async () => {
    try { await navigator.clipboard.writeText(text); setNotice('Copied. Nothing was sent.'); }
    catch { setNotice('Clipboard unavailable. Select the draft and copy it manually.'); }
  }}>Copy text</button>{notice && <small role="status">{notice}</small>}</>;
}
