import { useEffect, useRef, useState } from 'react';
import type { Language } from '../../domain/types';

export interface XpFeedbackValue {
  id: number;
  habitId: string;
  date: string;
  xp: number;
}

/** Decorative duplicate of the existing committed success announcement. */
export function XpFeedback({
  feedback,
  language = 'en',
}: {
  feedback?: XpFeedbackValue;
  language?: Language;
}) {
  const [visibleId, setVisibleId] = useState<number>();
  const lastId = useRef(-1);
  const active = useRef<{ id: number; until: number } | undefined>(undefined);
  useEffect(() => {
    if (!feedback) {
      active.current = undefined;
      setVisibleId(undefined);
      return;
    }
    if (feedback.id > lastId.current) {
      lastId.current = feedback.id;
      active.current = { id: feedback.id, until: Date.now() + 700 };
    }
    const remaining = active.current?.id === feedback.id ? active.current.until - Date.now() : 0;
    if (remaining <= 0) {
      setVisibleId(undefined);
      return;
    }
    setVisibleId(feedback.id);
    const timer = setTimeout(() => {
      active.current = undefined;
      setVisibleId(undefined);
    }, remaining);
    return () => clearTimeout(timer);
    // A completion id owns the timer; replacing display data must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback?.id]);
  if (!feedback || visibleId !== feedback.id) return null;
  return (
    <span className="today-xp-feedback" aria-hidden="true">
      +{new Intl.NumberFormat(language === 'pt' ? 'pt-BR' : 'en').format(feedback.xp)} XP
    </span>
  );
}
