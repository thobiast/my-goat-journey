import { useRef, useState } from 'react';
import type { ReturnOrigin, Route } from './routes';

export type Departure =
  { route: Route; freshPillars: boolean; restore?: ReturnOrigin } | { update: true };

export function useDepartureSession() {
  const [dirty, reportDirty] = useState(false);
  const [departure, setDeparture] = useState<Departure>();
  const pending = useRef(false);
  const editingFocus = useRef<HTMLElement | undefined>(undefined);

  function isPending() {
    return pending.current;
  }

  function requestConfirmation(request: Departure) {
    if (pending.current) return;
    pending.current = true;
    setDeparture(request);
  }

  function rememberEditingFocus(target: EventTarget | null) {
    if (
      !pending.current &&
      target instanceof HTMLElement &&
      target.closest('form') &&
      (target.matches('input,textarea,select') || target.closest('fieldset'))
    )
      editingFocus.current = target;
  }

  function dismissConfirmation() {
    pending.current = false;
    setDeparture(undefined);
  }

  function finishSession() {
    pending.current = false;
    editingFocus.current = undefined;
    reportDirty(false);
    setDeparture(undefined);
  }

  return {
    dirty,
    reportDirty,
    departure,
    returnFocus: editingFocus.current,
    isPending,
    requestConfirmation,
    rememberEditingFocus,
    dismissConfirmation,
    finishSession,
  };
}
