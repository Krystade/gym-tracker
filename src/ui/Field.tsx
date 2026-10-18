import { useCallback, useLayoutEffect, useReducer, useRef, type ChangeEvent, type InputHTMLAttributes, type Ref, type TextareaHTMLAttributes } from 'react';

/**
 * Text fields that keep what's typed when a render lands inside the keystroke. A controlled field is written back from its
 * `value` on every render; a render that comes after the field changed and before React's own listener sees the change (a
 * read or a sync coming back at that moment) wrote the old value over the keystroke, and React then saw no change, so it
 * was gone. These hold what's typed in the field itself and write `value` into it only when it moves, or straight after a
 * change React has handed on (so a value the screen turned down or reshaped still shows as the screen has it). They take
 * the same props as <input> and <textarea>, with `value` required.
 */
function useLiveValue<E extends HTMLInputElement | HTMLTextAreaElement>(value: string, outer: Ref<E> | undefined, onChange: ((e: ChangeEvent<E>) => void) | undefined) {
  const el = useRef<E | null>(null);
  const shown = useRef<string | null>(null); // the value as of the last render
  const handed = useRef(false); // a change went to onChange since then
  // Each change renders the field once more, so a change the screen turned down (its state the same) still puts it back.
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useLayoutEffect(() => {
    const node = el.current;
    if (node && (value !== shown.current || handed.current) && node.value !== value) node.value = value;
    shown.current = value;
    handed.current = false;
  });
  const ref = useCallback((node: E | null) => {
    el.current = node;
    if (typeof outer === 'function') outer(node);
    else if (outer) (outer as { current: E | null }).current = node;
  }, [outer]);
  const change = (e: ChangeEvent<E>) => { handed.current = true; rerender(); onChange?.(e); };
  return { ref, change };
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue'> & { value: string; ref?: Ref<HTMLInputElement> };
export function Input({ value, ref, onChange, ...props }: InputProps) {
  const live = useLiveValue(value, ref, onChange);
  return <input {...props} ref={live.ref} onChange={live.change} />;
}

type TextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'defaultValue'> & { value: string; ref?: Ref<HTMLTextAreaElement> };
export function TextArea({ value, ref, onChange, ...props }: TextAreaProps) {
  const live = useLiveValue(value, ref, onChange);
  return <textarea {...props} ref={live.ref} onChange={live.change} />;
}
