import { useEffect, useRef, useState } from 'react';
import { AtSign } from 'lucide-react';
import {
  MentionableUser, insertMention, mentionIsComplete, mentionQuery, mentionSuggestions,
} from '../utils/mentions';

/**
 * A textarea that offers colleagues after «@».
 *
 * One component, because there are two places a person writes a message that
 * may name somebody — the project's activity feed and a referral's thread —
 * and they are the same conversation: a reply typed in either lands in both.
 * Two copies of the suggestion list is how one comes to name people the other
 * cannot, which is exactly how «با @ ارجاع بده» came to work in the feed and
 * do nothing in the thread.
 *
 * It only *writes* the name. Turning a name into a referral is the server's
 * job (`parseMentions` against the real directory), so a name typed by hand
 * without the list raises the same referral as one picked from it.
 */
interface Props {
  value: string;
  onChange: (next: string) => void;
  users: MentionableUser[];
  placeholder?: string;
  className?: string;
  id?: string;
  rows?: number;
}

export default function MentionTextarea({
  value, onChange, users, placeholder, className, id, rows = 2,
}: Props) {
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const box = useRef<HTMLTextAreaElement | null>(null);

  const query = mentionQuery(value, caret);
  const suggestions = query === null ? [] : mentionSuggestions(query, users);
  /*
   * A finished mention closes the list.
   *
   * The completed name is still a name, so it still matches and the list would
   * stay open over it — and Enter would pick the same person again instead of
   * starting a new line.
   */
  const listOpen = query !== null && suggestions.length > 0
    && !mentionIsComplete(value, caret, users);

  // The list is rebuilt as the term narrows, so the highlighted row has to come
  // back to the top or it points past the end of a shorter list.
  useEffect(() => { setHighlight(0); }, [query]);

  /*
   * Where the cursor has to be put back after a name is inserted.
   *
   * React re-renders the textarea with the new value and the browser drops the
   * cursor at the end of it, so the caret is restored in an effect — after the
   * new value is on the node. Not `requestAnimationFrame`: that is a browser
   * global this component should not depend on, and it is absent when the
   * screen is rendered outside one.
   */
  const [pendingCaret, setPendingCaret] = useState<number | null>(null);
  useEffect(() => {
    if (pendingCaret === null) return;
    const node = box.current;
    setPendingCaret(null);
    if (!node) return;
    try {
      if (node.ownerDocument.activeElement !== node) node.focus();
      node.setSelectionRange(pendingCaret, pendingCaret);
    } catch {
      // Putting a text cursor back is a convenience, and no environment is
      // obliged to support it — a headless one does not implement the focus
      // machinery React reaches for. It must never take the composer down.
    }
  }, [pendingCaret]);

  const choose = (user: MentionableUser) => {
    const next = insertMention(value, caret, user);
    onChange(next.text);
    setCaret(next.caret);
    setPendingCaret(next.caret);
  };

  return (
    <div className="relative">
      <textarea
        ref={box}
        rows={rows}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? 0);
        }}
        onKeyUp={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onClick={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={(e) => {
          if (!listOpen) return;
          // While the list is open the arrows and Enter belong to it, not to
          // the textarea — otherwise Enter posts the message mid-name.
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight((h) => (h + 1) % suggestions.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
          } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            choose(suggestions[highlight]);
          } else if (e.key === 'Escape') {
            setCaret(value.length);
          }
        }}
        placeholder={placeholder}
        className={className}
        id={id}
        dir="rtl"
      />

      {listOpen && (
        <ul className="absolute z-30 right-2 bottom-full mb-1 w-64 max-h-52 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-lg py-1" data-mention-list>
          {suggestions.map((user, i) => (
            <li key={user.id}>
              <button
                type="button"
                // `onMouseDown`, not `onClick`: a click blurs the textarea
                // first, and the blur closes the list before the click lands.
                onMouseDown={(e) => { e.preventDefault(); choose(user); }}
                className={`w-full text-right px-3 py-1.5 text-xs flex items-center gap-1.5 transition ${
                  i === highlight ? 'bg-sky-50 text-sky-800' : 'hover:bg-slate-50 text-slate-700'
                }`}
              >
                <AtSign size={11} className="text-sky-500" />
                {user.fullName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
