/**
 * Switches to a new deploy that has taken over: now, unless a form has changes not saved yet, in which case once the
 * app is next in the background, where the reload interrupts nobody. Drafts outlive the reload either way; an open edit doesn't.
 */
export function reloadWhenSafe(dirty: () => boolean, reload: () => void, doc: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> = document) {
  if (doc.visibilityState === 'hidden' || !dirty()) { reload(); return; }
  const on = () => {
    if (doc.visibilityState !== 'hidden') return;
    doc.removeEventListener('visibilitychange', on);
    reload();
  };
  doc.addEventListener('visibilitychange', on);
}
