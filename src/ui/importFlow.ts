import { exportBackup, importBackup } from '../backup';
import { fetchInboxFile, listInbox } from '../inbox';
import { importFiles } from '../importer';
import type { ImportResult } from '../importer';
import { persist, refreshLibrary, state } from '../state';
import type { ImportSource } from '../types';
import { formatBytes, plural } from '../util';
import { confirmDialog, detailDialog, progressDialog, toast } from './overlay';

const AUDIO_ACCEPT = 'audio/*,.mp3,.m4a,.m4b,.aac,.flac,.wav,.aif,.aiff,.caf';

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reportImport(result: ImportResult): void {
  const parts: string[] = [];
  if (result.added > 0) parts.push(`${result.added} added`);
  if (result.skipped > 0) parts.push(`${result.skipped} already here`);
  if (result.failed > 0) parts.push(`${result.failed} failed`);

  const summary = parts.length > 0 ? parts.join(' · ') : 'Nothing new to add.';
  toast(result.cancelled ? `Stopped. ${summary}` : summary, result.failed > 0 ? 'error' : 'success');

  if (result.unsupported.length > 0) {
    const rows: Array<[string, string]> = result.unsupported
      .slice(0, 20)
      .map((item) => [item.name, item.reason]);
    detailDialog(`${result.unsupported.length} ${plural(result.unsupported.length, 'file')} skipped`, rows);
  }
}

/** Shared import path for the Files picker and the LAN inbox. */
export async function runImport(files: File[], source: ImportSource): Promise<void> {
  if (files.length === 0) return;

  let cancelled = false;
  const dialog = progressDialog({
    title: 'Adding music',
    label: 'Preparing…',
    onCancel: () => {
      cancelled = true;
      dialog.setLabel('Stopping after this track…');
    },
  });

  try {
    const result = await importFiles(files, {
      source,
      shouldCancel: () => cancelled,
      onProgress: (progress) => {
        dialog.setLabel(
          progress.phase === 'parse'
            ? 'Reading tags…'
            : progress.phase === 'store'
              ? 'Saving to this device…'
              : progress.phase === 'done'
                ? 'Finishing up…'
                : 'Preparing…',
        );
        dialog.setDetail(progress.current || `${progress.done} of ${progress.total}`);
        dialog.setValue(progress.done, progress.total);
      },
    });
    dialog.close();
    await refreshLibrary();
    reportImport(result);
  } catch (error) {
    dialog.close();
    toast(errorMessage(error), 'error');
  }
}

export function pickAudioFiles(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = AUDIO_ACCEPT;
  input.addEventListener(
    'change',
    () => {
      const files = Array.from(input.files ?? []);
      if (files.length > 0) void runImport(files, 'picker');
    },
    { once: true },
  );
  input.click();
}

/** "Pull from PC": lists the LAN inbox, downloads everything, then imports it. */
export async function pullFromInbox(): Promise<void> {
  const inboxUrl = state.settings.inboxUrl;
  let cancelled = false;

  const connect = progressDialog({
    title: 'Connecting',
    label: 'Looking for your computer…',
    onCancel: () => {
      cancelled = true;
    },
  });

  try {
    const listing = await listInbox(inboxUrl);
    connect.close();
    if (cancelled) return;

    const files = listing.files;
    if (files.length === 0) {
      toast(`Nothing to pull — the inbox folder is empty.`);
      return;
    }

    const bytes = files.reduce((sum, file) => sum + file.size, 0);
    const proceed = await confirmDialog({
      title: 'Pull from your computer?',
      message: `${files.length} ${plural(files.length, 'file')} (${formatBytes(bytes)}) from “${listing.directory || 'the inbox'}” will be downloaded to this device.`,
      confirmLabel: 'Download',
    });
    if (!proceed) return;

    const download = progressDialog({
      title: 'Downloading',
      label: 'Starting…',
      onCancel: () => {
        cancelled = true;
      },
    });

    const collected: File[] = [];
    for (let index = 0; index < files.length; index += 1) {
      if (cancelled) break;
      const entry = files[index];
      download.setLabel(`Downloading ${index + 1} of ${files.length}`);
      download.setDetail(entry.name);
      const file = await fetchInboxFile(inboxUrl, entry, (progress) => {
        download.setValue(progress.received, progress.total);
        download.setDetail(`${entry.name} · ${formatBytes(progress.received)} of ${formatBytes(progress.total)}`);
      });
      download.setValue(index + 1, files.length);
      collected.push(file);
    }

    download.close();
    if (collected.length === 0) return;
    await runImport(collected, 'inbox');
  } catch (error) {
    connect.close();
    toast(`Could not reach the inbox: ${errorMessage(error)}`, 'error');
  }
}

/** Writes the whole library to a ZIP the user can save to Files or iCloud. */
export async function downloadBackup(): Promise<void> {
  const dialog = progressDialog({ title: 'Creating backup', label: 'Packing your library…' });
  try {
    const blob = await exportBackup({
      favorites: [...state.favorites],
      recent: state.recent,
      onProgress: (progress) => {
        dialog.setLabel(
          progress.phase === 'reading'
            ? 'Reading audio…'
            : progress.phase === 'done'
              ? 'Finishing…'
              : 'Packing…',
        );
        dialog.setDetail(progress.current || `${progress.done} of ${progress.total}`);
        dialog.setValue(progress.done, progress.total);
      },
    });

    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `refaudio-backup-${stamp}.zip`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // Safari needs the URL to stay alive until the download has started.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);

    dialog.close();
    toast(`Backup saved (${formatBytes(blob.size)}).`, 'success');
  } catch (error) {
    dialog.close();
    toast(`Backup failed: ${errorMessage(error)}`, 'error');
  }
}

export async function restoreBackup(): Promise<void> {
  const file = await pickFile('.zip,application/zip');
  if (!file) return;

  const dialog = progressDialog({ title: 'Restoring backup', label: 'Reading archive…' });
  try {
    const result = await importBackup(file, {
      onProgress: (done, total) => {
        dialog.setLabel('Restoring tracks…');
        dialog.setDetail(`${done} of ${total}`);
        dialog.setValue(done, total);
      },
    });

    const favorites = [...new Set([...state.favorites, ...result.favorites])];
    const recent = [...new Set([...result.recent, ...state.recent])].slice(0, 100);
    await persist({ favorites, recent });
    await refreshLibrary();

    dialog.close();
    const parts = [`${result.added} tracks`, `${result.playlists} playlists`];
    if (result.skipped > 0) parts.push(`${result.skipped} already here`);
    if (result.missing > 0) parts.push(`${result.missing} without audio`);
    toast(`Restored ${parts.join(' · ')}.`, result.missing > 0 ? 'info' : 'success');
  } catch (error) {
    dialog.close();
    toast(errorMessage(error), 'error');
  }
}
