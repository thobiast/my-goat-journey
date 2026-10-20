import type { Copy } from '../features/habits/GoalFields';
import type { UpdateSnapshot } from './update';

/** Waiting releases are quiet; only an in-progress locked transition is announced. */
export function UpdateNotice({ copy, state }: { copy: Copy; state: UpdateSnapshot }) {
  return state.applying ? (
    <p role="status" className="visually-hidden">
      {copy.updateApplying}
    </p>
  ) : null;
}
