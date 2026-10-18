import { useState } from 'react';
import { addTag, BUILT_IN, cleanTag, hasTag, removeTag, showTag, TAG_MAX, type TagPrefs } from '../domain/tags';
import { Input } from './Field';

/** The tag row, edited in place under it: built-ins shown or hidden, their own tags removed or added. Each change saves. */
export function TagEditor({ prefs, onChange, onDone }: { prefs: TagPrefs; onChange: (t: TagPrefs) => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const t = cleanTag(text);
  const there = !!t && hasTag(prefs, t);
  const add = () => { if (!t || there) return; onChange(addTag(prefs, t)); setText(''); };
  return (
    <div className="tag-editor" role="group" aria-label="Edit tags">
      <ul className="tag-list">
        {BUILT_IN.map(([f, label]) => {
          const shown = !prefs.hidden.includes(f);
          return (
            <li key={f}>
              <span className={shown ? undefined : 'muted'}>{label}</span>
              <button type="button" role="switch" className="switch" aria-checked={shown} aria-label={`Show ${label}`} onClick={() => onChange(showTag(prefs, f, !shown))} />
            </li>
          );
        })}
        {prefs.custom.map((c) => (
          <li key={c}>
            <span>{c}</span>
            <button type="button" className="mini" aria-label={`Remove ${c}`} onClick={() => onChange(removeTag(prefs, c))}>×</button>
          </li>
        ))}
      </ul>
      <div className="tag-add">
        {/* Enter adds the tag; inside the set form it would otherwise log the set. */}
        <Input aria-label="Add a tag" placeholder="Add a tag" maxLength={TAG_MAX} enterKeyHint="done" value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button type="button" disabled={!t || there} onClick={add}>Add</button>
      </div>
      {there && <p className="muted small">Already a tag</p>}
      <button type="button" className="mini tag-done" onClick={onDone}>Done</button>
    </div>
  );
}
