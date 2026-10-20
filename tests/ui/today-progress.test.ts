import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { TodayHeader } from '../../src/features/today/TodayHeader';
import en from '../../src/i18n/en.json';
import pt from '../../src/i18n/pt.json';

for (const [language, copy, title] of [
  ['en', en, 'Your progress today'],
  ['pt', pt, 'Seu progresso de hoje'],
] as const) {
  test(`daily progress adds a supplementary required-only circle and readable count ${language}`, () => {
    const html = renderToStaticMarkup(
      createElement(TodayHeader, {
        copy,
        language,
        today: '2026-10-16',
        totalXp: 125,
        heading: { current: null },
        summary: { required: 4, requiredDone: 1, optional: 2, optionalDone: 2, status: 'pending' },
      }),
    );
    expect(html).toContain(title);
    expect(html).toContain('25%');
    expect(html).toContain(
      copy.todayCompletionCount.replace('{done}', '1').replace('{total}', '4'),
    );
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('today-complete-message');
  });
  test(`total XP has a small decorative Sparkles icon before the value and retains its description ${language}`, () => {
    const html = renderToStaticMarkup(
      createElement(TodayHeader, {
        copy,
        language,
        today: '2026-10-16',
        totalXp: 1234,
        heading: { current: null },
        summary: { required: 4, requiredDone: 1, optional: 0, optionalDone: 0, status: 'pending' },
      }),
    );
    const badge = html.match(
      /<span class="header-xp">([\s\S]*?)<span class="visually-hidden">([^<]*)<\/span><\/span>/,
    )!;
    const formatted = new Intl.NumberFormat(language === 'pt' ? 'pt-BR' : 'en').format(1234);
    expect(badge[1]).toMatch(
      /<span class="header-xp-value" aria-hidden="true"><svg[^>]*width="16"[^>]*height="16"[^>]*aria-hidden="true"[^>]*focusable="false"/,
    );
    expect(badge[1]).toContain(`</svg><span><strong>${formatted}</strong> XP</span></span>`);
    expect(badge[2]).toBe(copy.totalXpDescription.replace('{xp}', formatted));
  });
  test(`no required habits never produce a misleading percentage or zero denominator ${language}`, () => {
    const html = renderToStaticMarkup(
      createElement(TodayHeader, {
        copy,
        language,
        today: '2026-10-16',
        totalXp: 0,
        heading: { current: null },
        summary: { required: 0, requiredDone: 0, optional: 2, optionalDone: 0, status: 'neutral' },
      }),
    );
    expect(html).toContain(title);
    expect(html).toContain(copy.noRequired);
    expect(html).not.toContain('%');
    expect(html).not.toContain('0/0');
    expect(html).not.toContain('today-complete-message');
  });
}
