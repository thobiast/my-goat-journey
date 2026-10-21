import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ManagementIcon } from './icons/ManagementIcon';

// Shared by every trigger, including habit and pillar actions.
let dismissActive: ((restore: boolean) => void) | undefined;

interface ActionsDisclosureProps {
  label: string;
  context: string;
  closeLabel: string;
  busy: boolean;
  originKey: string;
  children: (close: () => void) => ReactNode;
}

/** Top-layer disclosure with native buttons, not an ARIA application menu. */
export function ActionsDisclosure({
  label,
  context,
  closeLabel,
  busy,
  originKey,
  children,
}: ActionsDisclosureProps) {
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(() => window.matchMedia('(max-width: 639px)').matches);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<(restore: boolean) => void>(() => {});
  useEffect(() => {
    const query = window.matchMedia('(max-width: 639px)');

    const update = () => setSheet(query.matches);

    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const node = panel.current!;
    let closed = false;
    const html = document.documentElement;
    const body = document.body;
    const previousOverflow = html.style.overflow;
    const previousPadding = body.style.paddingRight;
    const scrollbar = innerWidth - html.clientWidth;
    let locked = false;

    function unlock() {
      if (!locked) return;
      html.style.overflow = previousOverflow;
      body.style.paddingRight = previousPadding;
      locked = false;
    }

    function hide() {
      if (node.matches(':popover-open')) node.hidePopover();
      if (node.open) node.close();
      unlock();
    }

    function close(restore: boolean) {
      if (closed) return;
      closed = true;
      // Close synchronously before a route action; never schedule delayed trigger focus.
      if (!restore && node.contains(document.activeElement))
        (document.activeElement as HTMLElement).blur();
      hide();
      if (dismissActive === close) dismissActive = undefined;
      setOpen(false);
      if (restore && trigger.current?.isConnected) trigger.current.focus({ preventScroll: true });
    }

    closeRef.current = close;
    dismissActive = close;
    if (sheet) {
      body.style.paddingRight = `${parseFloat(getComputedStyle(body).paddingRight) + scrollbar}px`;
      html.style.overflow = 'hidden';
      locked = true;
      node.showModal();
    } else node.showPopover();

    const buttons = () =>
      Array.from(node.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));

    function focusEntry(button: HTMLButtonElement | undefined) {
      if (!button) return;
      button.focus({ preventScroll: true });
      const entry = button.getBoundingClientRect();
      const box = node.getBoundingClientRect();
      const padding = parseFloat(getComputedStyle(node).paddingTop) + 1;
      if (entry.top < box.top + padding) node.scrollTop -= box.top + padding - entry.top;
      else if (entry.bottom > box.bottom - padding)
        node.scrollTop += entry.bottom - box.bottom + padding;
    }

    buttons()[0]?.focus({ preventScroll: true });

    function position() {
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor) return;
      const gap = 8;
      const edge = 12;
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? innerWidth;
      const height = viewport?.height ?? innerHeight;
      const nav = document.querySelector('nav')?.getBoundingClientRect();
      // The existing measured navigation includes its safe-area inset; do not guess its height.
      const bottom =
        nav && nav.top > top && nav.top < top + height ? nav.top - edge : top + height - edge;
      node.style.maxHeight = `${Math.max(44, bottom - top - edge)}px`;
      node.style.maxWidth = `${Math.max(44, width - edge * 2)}px`;
      if (sheet) node.style.width = `${Math.min(480, width - edge * 2)}px`;
      const box = node.getBoundingClientRect();
      node.style.left = `${sheet ? left + (width - box.width) / 2 : Math.max(left + edge, Math.min(anchor.right - box.width, left + width - box.width - edge))}px`;
      const below = anchor.bottom + gap;
      node.style.top = `${sheet ? bottom - box.height : Math.max(top + edge, Math.min(below + box.height <= bottom ? below : anchor.top - box.height - gap, bottom - box.height))}px`;
    }

    position();
    focusEntry(buttons()[0]);

    function outside(event: PointerEvent) {
      const target = event.target as Node;
      // Modal backdrop pointer events target the dialog itself, outside its rectangle.
      const box = node.getBoundingClientRect();
      const inside =
        event.clientX >= box.left &&
        event.clientX <= box.right &&
        event.clientY >= box.top &&
        event.clientY <= box.bottom;
      if ((node.contains(target) && inside) || trigger.current?.contains(target)) return;
      const anotherTrigger =
        !sheet && target instanceof Element && target.closest('[data-action-trigger]');
      if (!anotherTrigger) event.preventDefault();
      close(!anotherTrigger);
    }

    function keys(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close(true);
        return;
      }
      if (!node.contains(document.activeElement)) return;
      const entries = buttons();
      const index = entries.indexOf(document.activeElement as HTMLButtonElement);
      let next: number;
      if (event.key === 'Tab' && sheet)
        next = (index + (event.shiftKey ? -1 : 1) + entries.length) % entries.length;
      else if (event.key === 'ArrowDown') next = (index + 1) % entries.length;
      else if (event.key === 'ArrowUp') next = (index - 1 + entries.length) % entries.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = entries.length - 1;
      else return;
      event.preventDefault();
      focusEntry(entries[next]);
    }

    function focusOutside(event: FocusEvent) {
      if (
        !sheet &&
        !node.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        close(false);
    }

    function cancel(event: Event) {
      event.preventDefault();
      close(true);
    }

    function nativeClosed() {
      // StrictMode cleanup or a rapid reopen can leave an earlier close event queued.
      if (!node.open) close(true);
    }

    if (sheet) {
      node.addEventListener('cancel', cancel);
      node.addEventListener('close', nativeClosed);
    }
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keys, true);
    document.addEventListener('focusin', focusOutside);
    window.addEventListener('scroll', position, true);
    window.addEventListener('resize', position);
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
    const observer = new ResizeObserver(position);
    observer.observe(node);
    const nav = document.querySelector('nav');
    if (nav) observer.observe(nav);
    return () => {
      closed = true;
      if (dismissActive === close) dismissActive = undefined;
      node.removeEventListener('cancel', cancel);
      node.removeEventListener('close', nativeClosed);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', keys, true);
      document.removeEventListener('focusin', focusOutside);
      window.removeEventListener('scroll', position, true);
      window.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('scroll', position);
      observer.disconnect();
      if (node.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
      hide();
    };
  }, [open, sheet]);

  return (
    <div className="management-actions">
      <button
        ref={trigger}
        type="button"
        className="action-trigger"
        disabled={busy}
        data-action-trigger
        data-history-id={originKey}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          if (open) closeRef.current(true);
          else {
            dismissActive?.(false);
            setOpen(true);
          }
        }}
      >
        <ManagementIcon name="ellipsis" />
      </button>
      {open &&
        createPortal(
          <dialog
            key={String(sheet)}
            ref={panel}
            id={id}
            popover={sheet ? undefined : 'manual'}
            className={`actions-panel${sheet ? ' actions-sheet' : ''}`}
            data-action-surface
            aria-label={label}
            aria-modal={sheet}
          >
            {sheet && <h2 className="actions-context">{context}</h2>}
            {children(() => closeRef.current(false))}
            <button type="button" className="actions-close" onClick={() => closeRef.current(true)}>
              {closeLabel}
            </button>
          </dialog>,
          document.body,
        )}
    </div>
  );
}
