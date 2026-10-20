import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';

/** Route announcements keep focus; only keyboard entry needs a visible title ring.
 * Native :focus-visible can match an initial programmatic focus without input.
 */
export function usePageHeadingFocus(heading: RefObject<HTMLHeadingElement | null>) {
  const keyboard = useRef(false);
  useLayoutEffect(() => {
    const keydown = () => {
      keyboard.current = true;
      if (document.activeElement === heading.current)
        heading.current?.setAttribute('data-keyboard-focus', '');
    };

    const pointer = () => {
      keyboard.current = false;
      heading.current?.removeAttribute('data-keyboard-focus');
    };

    document.addEventListener('keydown', keydown, true);
    document.addEventListener('pointerdown', pointer, true);
    document.addEventListener('touchstart', pointer, { capture: true, passive: true });
    return () => {
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('pointerdown', pointer, true);
      document.removeEventListener('touchstart', pointer, true);
    };
  }, [heading]);
  return useCallback(
    (preventScroll = false) => {
      const target = heading.current;
      if (!target) return;
      target.setAttribute('data-route-heading', '');
      target.toggleAttribute('data-keyboard-focus', keyboard.current);
      target.focus({ preventScroll });
    },
    [heading],
  );
}
