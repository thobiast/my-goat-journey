import { useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Copy } from '../features/habits/GoalFields';
import './discard-dialog.css';

/** Native top-layer modality makes the entire app, including navigation, inert. */
export function DiscardDialog({
  copy,
  keepEditing,
  discard,
  returnFocus,
}: {
  copy: Copy;
  keepEditing: () => void;
  discard: () => void;
  returnFocus?: HTMLElement;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const id = useId();
  // Route and focus callbacks are intentionally captured for this one departure.
  useLayoutEffect(() => {
    const node = dialog.current!;
    const html = document.documentElement;
    const body = document.body;
    const focus =
      returnFocus ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
    const field =
      focus instanceof HTMLTextAreaElement || focus instanceof HTMLInputElement ? focus : undefined;
    const selection = field ? ([field.selectionStart, field.selectionEnd] as const) : undefined;
    const y = scrollY;
    const x = scrollX;
    const overflow = html.style.overflow;
    const padding = body.style.paddingRight;
    const scrollbar = innerWidth - html.clientWidth;
    let finished = false;
    let restored = false;
    body.style.paddingRight = `${parseFloat(getComputedStyle(body).paddingRight) + scrollbar}px`;
    html.style.overflow = 'hidden';

    function unlock() {
      html.style.overflow = overflow;
      body.style.paddingRight = padding;
    }

    function restore() {
      if (restored) return;
      restored = true;
      unlock();
      window.scrollTo(x, y);
      if (focus?.isConnected) {
        focus.focus({ preventScroll: true });
        if (field && selection && selection[0] !== null && selection[1] !== null) {
          try {
            field.setSelectionRange(selection[0], selection[1]);
          } catch {
            /* Not a text selection input. */
          }
        }
      }
    }

    function finish(discardDraft = false) {
      if (finished) return;
      finished = true;
      if (discardDraft && node.contains(document.activeElement))
        (document.activeElement as HTMLElement).blur();
      node.close();
      unlock();
      if (discardDraft) discard();
      else {
        restore();
        keepEditing();
      }
    }

    function position() {
      const viewport = window.visualViewport;
      const width = viewport?.width ?? innerWidth;
      const height = viewport?.height ?? innerHeight;
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      node.style.maxWidth = `${Math.max(0, width - 24)}px`;
      node.style.maxHeight = `${Math.max(0, height - 24)}px`;
      const box = node.getBoundingClientRect();
      node.style.left = `${left + (width - box.width) / 2}px`;
      node.style.top = `${top + Math.max(12, (height - box.height) / 2)}px`;
    }

    node.showModal();
    position();
    keep.current?.focus({ preventScroll: true });
    window.scrollTo(x, y);

    function cancel(event: Event) {
      event.preventDefault();
      finish();
    }

    // StrictMode can deliver an earlier cleanup's queued close after reopening.
    function closed() {
      if (!node.open) finish();
    }

    function backdrop(event: PointerEvent) {
      const box = node.getBoundingClientRect();
      if (
        event.target === node &&
        (event.clientX < box.left ||
          event.clientX > box.right ||
          event.clientY < box.top ||
          event.clientY > box.bottom)
      ) {
        event.preventDefault();
        finish();
      }
    }

    function keys(event: KeyboardEvent) {
      if (event.key !== 'Tab') return;
      const buttons = Array.from(node.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      event.preventDefault();
      buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus({
        preventScroll: true,
      });
      revealFocus();
    }

    function revealFocus() {
      const target = document.activeElement;
      if (!(target instanceof HTMLElement) || !node.contains(target)) return;
      const rect = target.getBoundingClientRect();
      const box = node.getBoundingClientRect();
      const edge = 12;
      if (rect.bottom > box.bottom - edge) node.scrollTop += rect.bottom - box.bottom + edge;
      else if (rect.top < box.top + edge) node.scrollTop -= box.top + edge - rect.top;
    }

    function resize() {
      position();
      revealFocus();
    }

    node.addEventListener('cancel', cancel);
    node.addEventListener('close', closed);
    node.addEventListener('pointerdown', backdrop);
    node.addEventListener('keydown', keys);
    node.addEventListener('focusin', revealFocus);
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('scroll', resize);
    const observer = new ResizeObserver(resize);
    observer.observe(node);

    // Buttons use the same guarded completion as native Escape/backdrop/close.
    const onKeep = () => finish();

    const onDiscard = () => finish(true);

    const keepButton = keep.current!;
    keepButton.addEventListener('click', onKeep);
    const discardButton = node.querySelector<HTMLButtonElement>('[data-discard]')!;
    discardButton.addEventListener('click', onDiscard);
    return () => {
      node.removeEventListener('cancel', cancel);
      node.removeEventListener('close', closed);
      node.removeEventListener('pointerdown', backdrop);
      node.removeEventListener('keydown', keys);
      node.removeEventListener('focusin', revealFocus);
      keepButton.removeEventListener('click', onKeep);
      discardButton.removeEventListener('click', onDiscard);
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('scroll', resize);
      observer.disconnect();
      if (node.open) node.close();
      unlock();
    };
    // Capture one departure's callbacks/focus; rerenders must not close/reopen the modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="discard-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
    >
      <h2 id={`${id}-title`}>{copy.unsavedChanges}</h2>
      <p id={`${id}-description`}>{copy.unsavedChangesDescription}</p>
      <div className="discard-dialog-actions">
        <button ref={keep} type="button" autoFocus>
          {copy.keepEditing}
        </button>
        <button type="button" className="discard-secondary" data-discard>
          {copy.discardChanges}
        </button>
      </div>
    </dialog>,
    document.body,
  );
}
