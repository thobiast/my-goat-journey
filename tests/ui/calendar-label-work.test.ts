import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { DailyCalendar } from '../../src/features/progress/ConsistencyCard';
import { calendarDays, periodWindow } from '../../src/features/progress/calendar';
import { parseLocalDate } from '../../src/domain/calendar';
import { facts } from '../domain/fixtures';
import en from '../../src/i18n/en.json';
import pt from '../../src/i18n/pt.json';

test.each(['en', 'pt'] as const)(
  'calendar %s preserves every full-date label without constructing a formatter per cell',
  (language) => {
    const data = facts();
    const window = periodWindow('2026-10-03', '3m', 0);
    const days = calendarDays(data, { kind: 'habit', id: 'read' }, window);
    const formatter = new Intl.DateTimeFormat(language === 'pt' ? 'pt-BR' : 'en', {
      timeZone: 'UTC',
      dateStyle: 'full',
    });
    const labels = days
      .filter((day) => day.applicable || day.date < data.habits[0].createdOn)
      .map((day) => formatter.format(parseLocalDate(day.date)));
    const nativeFormatter = Intl.DateTimeFormat;
    let fullDateConstructors = 0;
    Intl.DateTimeFormat = new Proxy(nativeFormatter, {
      construct(target, args) {
        if (args[1]?.dateStyle === 'full') fullDateConstructors++;
        return Reflect.construct(target, args);
      },
    });
    try {
      const html = renderToStaticMarkup(
        createElement(DailyCalendar, {
          days,
          window,
          interval: '3m',
          language,
          copy: language === 'pt' ? pt : en,
          scopeKey: 'habit:read',
          open: () => {},
          busy: false,
          start: data.habits[0].createdOn,
        }),
      );
      for (const label of labels) expect(html).toContain(`${label} · `);
      expect(fullDateConstructors).toBe(1);
    } finally {
      Intl.DateTimeFormat = nativeFormatter;
    }
  },
);
