import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { SettingsPage } from '../../src/features/settings/SettingsPage';
import { facts } from '../domain/fixtures';
import en from '../../src/i18n/en.json';
import pt from '../../src/i18n/pt.json';

const noop = () => {};

test.each([
  { copy: en, titles: ['Preferences', 'Backup &amp; restore', 'Data management'] },
  { copy: pt, titles: ['Preferências', 'Backup e restauração', 'Gerenciamento de dados'] },
])(
  'Settings groups only existing preferences, backup and destructive actions: $titles',
  ({ copy, titles }) => {
    const data = facts();
    const before = structuredClone(data);
    const html = renderToStaticMarkup(
      createElement(SettingsPage, {
        data,
        copy,
        busy: false,
        settings: noop,
        fresh: async () => data,
        replace: noop,
        edited: noop,
        reset: noop,
      }),
    );
    const sections = [...html.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/g)].map(
      (match) => match[1],
    );
    expect(sections).toHaveLength(3);
    titles.forEach((title, index) =>
      expect(sections[index]).toContain(
        `<h2 id="settings-${['preferences', 'backup', 'data'][index]}-heading">${title}</h2>`,
      ),
    );
    expect(sections[0]).toContain('id="language"');
    expect(sections[0]).toContain('type="checkbox"');
    expect(sections[0]).not.toContain(copy.storageNote);
    expect(sections[1]).toContain(copy.storageNote);
    expect(sections[1]).toContain(copy.backupPrivacy);
    expect(sections[1]).toContain(copy.exportBackup);
    expect(sections[1]).toContain('id="backup-file"');
    expect(sections[2]).toContain(copy.deleteOpen);
    expect(sections[2]).not.toContain('id="backup-file"');
    expect(html.match(/type="checkbox"/g) ?? []).toHaveLength(1);
    expect(data).toEqual(before);
  },
);
