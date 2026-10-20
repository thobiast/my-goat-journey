import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { UpdateSnapshot } from '../../pwa/update';
import { BackupError, parseBackup, serializeBackup } from '../../data/backup';
import { deviceClock, localDate } from '../../domain/calendar';
import type { Dataset, Settings } from '../../domain/types';
import type { Copy } from '../habits/GoalFields';
import './settings.css';

interface SettingsPageProps {
  data: Dataset;
  copy: Copy;
  busy: boolean;
  beginOperation?: () => () => void;
  blockUpdate?: (blocked: boolean) => void;
  updateState?: UpdateSnapshot;
  checkUpdate?: () => void;
  applyUpdate?: () => void;
  updateBlocked?: boolean;
  settings: (patch: Partial<Settings>) => void;
  fresh: () => Promise<Dataset>;
  replace: (candidate: Dataset, revision: number, after: () => void) => void;
  edited: () => void;
  reset: (revision: number) => void;
}

export function SettingsPage({
  data,
  copy,
  busy,
  settings,
  fresh,
  replace,
  edited,
  reset,
  beginOperation,
  blockUpdate,
  updateState,
  checkUpdate,
  applyUpdate,
  updateBlocked = false,
}: SettingsPageProps) {
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [candidate, setCandidate] = useState<{
    dataset: Dataset;
    exportedAt: string;
    name: string;
    revision: number;
  }>();
  const [deletion, setDeletion] = useState<{ revision: number }>();
  useLayoutEffect(() => {
    blockUpdate?.(checking || exporting || !!candidate || !!deletion);
  }, [checking, exporting, candidate, deletion, blockUpdate]);
  useEffect(() => () => blockUpdate?.(false), [blockUpdate]);
  const deleteCancel = useRef<HTMLButtonElement>(null);
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (deletion) deleteCancel.current?.focus();
  }, [deletion]);
  const validation = useRef(0);
  const restoreInput = useRef<HTMLInputElement>(null);

  const cancel = () => {
    ++validation.current;
    setChecking(false);
    setCandidate(undefined);
    setStatus('');
    setError('');
    edited();
  };

  async function choose(file: File) {
    const finishOperation = beginOperation?.();
    blockUpdate?.(true);
    const token = ++validation.current;
    const revision = data.revision;
    edited();
    setCandidate(undefined);
    setStatus('');
    setError('');
    setChecking(true);
    try {
      const parsed = await parseBackup(file);
      if (token === validation.current) setCandidate({ ...parsed, name: file.name, revision });
    } catch (error) {
      if (token === validation.current)
        setError(
          error instanceof BackupError && error.code === 'size'
            ? copy.fileTooLarge
            : copy.invalidBackup,
        );
    } finally {
      if (token === validation.current) setChecking(false);
      finishOperation?.();
    }
  }

  async function exportBackup() {
    const finishOperation = beginOperation?.();
    blockUpdate?.(true);
    setStatus('');
    setError('');
    setExporting(true);
    try {
      const committed = await fresh();
      const now = deviceClock.now();
      const blob = serializeBackup(committed, now);
      const filename = `my-goat-journey-backup-${localDate(now)}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}.json`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(copy.downloadStarted);
    } catch (error) {
      setError(
        error instanceof BackupError && error.code === 'size'
          ? copy.backupTooLarge
          : copy.saveError,
      );
    } finally {
      setExporting(false);
      finishOperation?.();
    }
  }

  const updateDisabled =
    busy ||
    updateBlocked ||
    checking ||
    exporting ||
    !!candidate ||
    !!deletion ||
    !!updateState?.checking ||
    !!updateState?.applying;
  const updateFeedback = updateState?.applying
    ? copy.updateApplying
    : updateState?.checking
      ? copy.updateChecking
      : updateState?.checkStatus === 'offline'
        ? copy.updateOffline
        : updateState?.failed && updateState.checkStatus !== 'failed'
          ? copy.updateApplyFailed
          : updateState?.checkStatus === 'failed'
            ? copy.updateCheckFailed
            : updateState?.available
              ? copy.updateAwaitingSafe
              : updateState?.checkStatus === 'current'
                ? copy.updateCurrent
                : '';
  return (
    <div className="settings-content">
      <section className="settings-section" aria-labelledby="settings-preferences-heading">
        <h2 id="settings-preferences-heading">{copy.settingsPreferences}</h2>
        <label htmlFor="language">{copy.language}</label>
        <select
          id="language"
          disabled={busy}
          value={data.settings.language}
          onChange={(event) => settings({ language: event.target.value as Settings['language'] })}
        >
          <option value="en">English</option>
          <option value="pt">Português (Brasil)</option>
        </select>
        <label className="checkbox-label">
          <input
            type="checkbox"
            disabled={busy}
            checked={data.settings.reducedMotion}
            onChange={(event) => settings({ reducedMotion: event.target.checked })}
          />
          {copy.reducedMotion}
        </label>
        {updateState?.supported && (
          <div className="settings-update">
            <button disabled={updateDisabled} onClick={checkUpdate}>
              {updateState.checking ? copy.updateChecking : copy.updateCheck}
            </button>
            {updateState.available && !updateState.applying && (
              <button className="secondary" disabled={updateDisabled} onClick={applyUpdate}>
                {copy.updateNow}
              </button>
            )}
            {updateFeedback && <p role="status">{updateFeedback}</p>}
          </div>
        )}
      </section>
      <section className="settings-section" aria-labelledby="settings-backup-heading">
        <h2 id="settings-backup-heading">{copy.settingsBackupRestore}</h2>
        <p className="settings-help">{copy.storageNote}</p>
        <p className="settings-help">{copy.backupPrivacy}</p>
        <button disabled={busy || exporting} onClick={() => void exportBackup()}>
          {copy.exportBackup}
        </button>
        <div className="settings-restore">
          <h3>{copy.restoreBackup}</h3>
          <label htmlFor="backup-file">{copy.chooseBackup}</label>
          <input
            ref={restoreInput}
            id="backup-file"
            type="file"
            accept=".json,application/json"
            disabled={busy || checking}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void choose(file);
            }}
          />
        </div>
        {checking && <p role="status">{copy.checkingBackup}</p>}
        {candidate && (
          <div className="confirmation">
            <h3>{copy.backupReady}</h3>
            <p className="user-content">{candidate.name}</p>
            <p>
              {copy.savedOn.replace(
                '{date}',
                new Intl.DateTimeFormat(data.settings.language === 'pt' ? 'pt-BR' : 'en', {
                  dateStyle: 'medium',
                }).format(new Date(candidate.exportedAt)),
              )}
            </p>
            <p>
              {copy.backupCounts
                .replace('{habits}', String(candidate.dataset.habits.length))
                .replace('{records}', String(candidate.dataset.occurrences.length))}
            </p>
            <p>{copy.replaceWarning}</p>
            <div className="action-row">
              <button disabled={busy || exporting} onClick={() => void exportBackup()}>
                {copy.exportCurrent}
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  cancel();
                  requestAnimationFrame(() => restoreInput.current?.focus());
                }}
              >
                {copy.cancel}
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  replace(candidate.dataset, candidate.revision, () => {
                    setCandidate(undefined);
                    setStatus(copy.backupRestored);
                  })
                }
              >
                {busy ? copy.restoring : copy.replaceData}
              </button>
            </div>
          </div>
        )}
      </section>
      <section className="settings-section delete-section" aria-labelledby="settings-data-heading">
        <h2 id="settings-data-heading">{copy.settingsDataManagement}</h2>
        <p className="settings-help">{copy.deleteSeparate}</p>
        {!deletion ? (
          <button
            className="destructive"
            ref={deleteTrigger}
            disabled={busy}
            onClick={() => {
              cancel();
              setDeletion({ revision: data.revision });
            }}
          >
            {copy.deleteOpen}
          </button>
        ) : (
          <div className="confirmation" role="group" aria-labelledby="delete-question">
            <h3 id="delete-question">{copy.deleteQuestion}</h3>
            <p>{copy.deleteHelp}</p>
            <div className="action-row">
              <button disabled={busy || exporting} onClick={() => void exportBackup()}>
                {copy.exportCurrent}
              </button>
              <button
                ref={deleteCancel}
                disabled={busy}
                onClick={() => {
                  setDeletion(undefined);
                  edited();
                  requestAnimationFrame(() => deleteTrigger.current?.focus());
                }}
              >
                {copy.cancel}
              </button>
              <button
                className="destructive"
                disabled={busy}
                onClick={() => reset(deletion.revision)}
              >
                {copy.deleteAllData}
              </button>
            </div>
          </div>
        )}
      </section>
      {error && <p role="alert">{error}</p>}
      <p role="status" aria-live="polite" aria-atomic="true">
        {status}
      </p>
    </div>
  );
}
