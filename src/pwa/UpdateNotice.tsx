import type { Copy } from '../i18n/copy';
import type { UpdateSnapshot } from './update';

/** Waiting releases are quiet; only an in-progress locked transition is announced. */
export function UpdateNotice({ copy, state }: { copy: Copy; state: UpdateSnapshot }) {
  return (
    <p
      role={state.applying ? 'status' : undefined}
      aria-label={state.applying ? copy.updateApplying : undefined}
      aria-live="polite"
      aria-atomic="true"
      className="visually-hidden"
    >
      {state.applying ? copy.updateApplying : ''}
    </p>
  );
}
