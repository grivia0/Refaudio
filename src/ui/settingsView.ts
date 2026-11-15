import { player, removePlaylist } from '../app';
import { clearLibrary, requestPersistence, storageState, type StorageState } from '../db';
import { listInbox } from '../inbox';
import { persist, refreshLibrary, state } from '../state';
import { formatBytes, plural } from '../util';
import { el, icon } from './dom';
import { downloadBackup, pickAudioFiles, pullFromInbox, restoreBackup } from './importFlow';
import { confirmDialog, promptDialog, toast } from './overlay';
import { applyReduceTransparency } from './theme';

export interface SettingsView {
  node: HTMLElement;
  update: () => void;
}

function card(title: string): HTMLElement {
  const node = el('section', 'card');
  node.append(el('h2', 'card__title', title));
  return node;
}

function smallButton(label: string, handler: () => void, className = 'btn--small'): HTMLButtonElement {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', handler);
  return node;
}

function row(label: string, hint?: string): { node: HTMLElement; tail: HTMLElement } {
  const node = el('div', 'card__row');
  const text = el('div');
  text.append(el('div', 'card__label', label));
  if (hint) text.append(el('div', 'card__hint', hint));
  const tail = el('div');
  node.append(text, tail);
  return { node, tail };
}

function toggle(initial: boolean, onChange: (value: boolean) => void): HTMLButtonElement {
  const node = el('button', 'toggle');
  node.type = 'button';
  node.setAttribute('role', 'switch');
  node.setAttribute('aria-checked', initial ? 'true' : 'false');
  node.addEventListener('click', () => {
    const next = node.getAttribute('aria-checked') !== 'true';
    node.setAttribute('aria-checked', next ? 'true' : 'false');
    onChange(next);
  });
  return node;
}

export function createSettingsView(): SettingsView {
  const view = el('section', 'view');
  view.id = 'view-settings';

  const head = el('div', 'view-head');
  head.append(el('h1', 'view-title', 'Settings'));

  const scroller = el('div', 'settings');
  view.append(head, scroller);

  /* -------------------------------- storage ----------------------------- */
  const storageCard = card('Storage');
  const meter = el('div', 'meter');
  const meterBar = el('span');
  meter.append(meterBar);
  const storageLine = el('p', 'card__hint', 'Measuring…');
  const storageRow = row('Space used on this iPhone');
  const persistBtn = smallButton('Keep data safe', () => {
    void requestPersistence().then((granted) => {
      toast(granted ? 'This device will keep Refaudio data.' : 'Safari declined; keep using the app to earn persistence.', granted ? 'success' : 'info');
      void refreshStorage();
    });
  }, 'btn--small is-accent');

  storageRow.tail.append(persistBtn);
  storageCard.append(meter, storageLine, storageRow.node);

  /* -------------------------------- import ------------------------------ */
  const importCard = card('Add music');
  const filesRow = row('From this iPhone', 'Pick files from the Files app or iCloud Drive.');
  filesRow.tail.append(smallButton('Choose files', () => pickAudioFiles()));

  const pullRow = row('Pull from computer', 'Downloads everything in the inbox folder on your PC.');
  pullRow.tail.append(smallButton('Pull', () => void pullFromInbox()));

  const inboxRow = row('Inbox address');
  const inboxValue = el('button', 'btn--small inbox-value', 'Same origin');
  inboxValue.type = 'button';
  inboxValue.addEventListener('click', () => {
    void promptDialog({
      title: 'Inbox address',
      label: 'Server URL',
      value: state.settings.inboxUrl,
      placeholder: 'http://192.168.1.20:8765',
      confirmLabel: 'Save',
    }).then((value) => {
      if (value === null) return;
      void persist({ inboxUrl: value }).then(() => {
        toast(value ? 'Inbox address saved.' : 'Using the same origin.', 'success');
        update();
      });
    });
  });

  const testBtn = smallButton('Test', () => {
    void listInbox(state.settings.inboxUrl)
      .then((listing) => {
        toast(
          listing.files.length > 0
            ? `Inbox ready — ${listing.files.length} ${plural(listing.files.length, 'file')} waiting.`
            : 'Inbox reachable but empty.',
          'success',
        );
      })
      .catch((error: unknown) => {
        toast(`Inbox unreachable: ${error instanceof Error ? error.message : String(error)}`, 'error');
      });
  });

  inboxRow.tail.append(inboxValue, testBtn);
  importCard.append(filesRow.node, pullRow.node, inboxRow.node);

  /* -------------------------------- backup ------------------------------ */
  const backupCard = card('Backup');
  const exportRow = row('Export library', 'One ZIP with metadata, playlists and audio.');
  exportRow.tail.append(smallButton('Backup', () => void downloadBackup(), 'btn--small is-accent'));

  const restoreRow = row('Restore from backup', 'Merges a Refaudio ZIP into this library.');
  restoreRow.tail.append(smallButton('Restore', () => void restoreBackup()));
  backupCard.append(exportRow.node, restoreRow.node);

  /* ------------------------------ appearance ---------------------------- */
  const appearanceCard = card('Appearance');
  const transparencyRow = row('Reduce transparency', 'Solid panels instead of blur. Helps older iPhones keep scrolling smooth.');
  const transparencyToggle = toggle(state.settings.reduceTransparency, (value) => {
    applyReduceTransparency(value);
    void persist({ reduceTransparency: value });
  });
  transparencyRow.tail.append(transparencyToggle);
  appearanceCard.append(transparencyRow.node);

  /* -------------------------------- about ------------------------------- */
  const aboutCard = card('About');
  const about = el('dl', 'kv');
  const trackCount = el('dd', undefined, '0');
  const playlistCount = el('dd', undefined, '0');
  const versionValue = el('dd', undefined, '0.1.0');
  const installState = el('dd', undefined, 'Browser');
  about.append(
    el('dt', undefined, 'Tracks'),
    trackCount,
    el('dt', undefined, 'Playlists'),
    playlistCount,
    el('dt', undefined, 'Version'),
    versionValue,
    el('dt', undefined, 'Running as'),
    installState,
  );
  aboutCard.append(about);

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (!isStandalone) {
    const tip = el('div', 'tip');
    tip.append(icon('plus', { size: 18 }));
    tip.append(
      el(
        'p',
        'tip__text',
        'To install: open this page in Safari, tap the Share button, then “Add to Home Screen”. Installed, Refaudio runs full-screen and keeps your music available offline.',
      ),
    );
    aboutCard.append(tip);
  }

  /* -------------------------------- danger ------------------------------ */
  const dangerCard = card('On this device');
  const clearRow = row('Clear library', 'Deletes every track, cover and playlist. Export a backup first.');
  clearRow.tail.append(
    smallButton(
      'Clear',
      () => {
        void confirmDialog({
          title: 'Clear the library?',
          message: 'All music stored in Refaudio on this device will be deleted. This cannot be undone.',
          confirmLabel: 'Delete everything',
          danger: true,
        }).then((confirmed) => {
          if (!confirmed) return;
          player.stop();
          void (async () => {
            for (const playlist of [...state.playlists]) await removePlaylist(playlist.id);
            await clearLibrary();
            await refreshLibrary();
            update();
            toast('Library cleared.', 'success');
          })();
        });
      },
      'btn--small is-danger',
    ),
  );

  const debug = el('pre', 'debug');
  dangerCard.append(clearRow.node, debug);

  scroller.append(storageCard, importCard, backupCard, appearanceCard, aboutCard, dangerCard);

  /* ------------------------------- refresh ------------------------------ */
  let storage: StorageState | null = null;

  async function refreshStorage(): Promise<void> {
    storage = await storageState();
    if (!storage) {
      storageLine.textContent = 'Storage information is not available in this browser.';
      meterBar.style.width = '0%';
      return;
    }
    const pct = storage.quota > 0 ? (storage.usage / storage.quota) * 100 : 0;
    meterBar.style.width = `${Math.min(100, pct).toFixed(1)}%`;
    storageLine.textContent = `${formatBytes(storage.usage)} of ${formatBytes(storage.quota)} used (${pct.toFixed(1)}%)${storage.persisted ? ' · protected from eviction' : ''}`;
    persistBtn.hidden = storage.persisted;
    updateDebug();
  }

  function updateDebug(): void {
    const lines = [
      `tracks: ${state.tracks.length} · playlists: ${state.playlists.length}`,
      `storage: ${storage ? `${formatBytes(storage.usage)} / ${formatBytes(storage.quota)}` : 'n/a'}`,
      `persisted: ${storage ? String(storage.persisted) : 'n/a'}`,
      `inbox: ${state.settings.inboxUrl || location.origin}`,
      `service worker: ${'serviceWorker' in navigator ? (navigator.serviceWorker.controller ? 'active' : 'not yet') : 'unsupported'}`,
      `standalone: ${String(isStandalone)}`,
      `viewport: ${window.innerWidth}×${window.innerHeight}`,
      `ua: ${navigator.userAgent}`,
    ];
    debug.textContent = lines.join('\n');
  }

  const update = (): void => {
    inboxValue.textContent = state.settings.inboxUrl || 'Same origin';
    trackCount.textContent = `${state.tracks.length}`;
    playlistCount.textContent = `${state.playlists.length}`;
    installState.textContent = isStandalone ? 'Home Screen app' : 'Safari';
    transparencyToggle.setAttribute('aria-checked', state.settings.reduceTransparency ? 'true' : 'false');
    void refreshStorage();
  };

  return { node: view, update };
}
