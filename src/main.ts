import './styles/tokens.css';
import './styles/app.css';

import { player, restorePlayer } from './app';
import { bootstrapState, persist, setState, state, subscribe } from './state';
import { clear, el, isEditable, on } from './ui/dom';
import { pickAudioFiles, pullFromInbox, restoreBackup } from './ui/importFlow';
import { createLibraryView } from './ui/libraryView';
import { actionSheet, confirmDialog, mountToasts, toast } from './ui/overlay';
import { createPlayerUI } from './ui/playerView';
import { createPlaylistsView } from './ui/playlistsView';
import { createSettingsView } from './ui/settingsView';
import { createShell } from './ui/shell';
import { applyReduceTransparency } from './ui/theme';
import { watchViewportHeight } from './ui/viewport';
import { registerSW } from 'virtual:pwa-register';

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function openImportMenu(): void {
  actionSheet('Add music', [
    { label: 'Choose files', hint: 'Files app', onSelect: () => pickAudioFiles() },
    { label: 'Pull from computer', hint: 'Wi-Fi inbox', onSelect: () => void pullFromInbox() },
    { label: 'Restore backup', hint: '.zip', onSelect: () => void restoreBackup() },
  ]);
}

function showBootError(mount: HTMLElement, error: unknown): void {
  clear(mount);
  const box = el('div', 'boot');
  const card = el('div', 'empty-card');
  card.append(
    el('h3', undefined, 'Refaudio could not start'),
    el('p', undefined, error instanceof Error ? error.message : String(error)),
  );
  const reload = el('button', 'btn btn--primary', 'Reload');
  reload.type = 'button';
  reload.addEventListener('click', () => window.location.reload());
  card.append(reload);

  const tip = el(
    'p',
    'boot__text',
    'If this keeps happening, make sure Safari is not in Private Browsing — private tabs cannot store your library.',
  );
  box.append(el('div', 'boot__logo'), card, tip);
  mount.append(box);
}

const INSTALL_TIP_KEY = 'refaudio.installTip';

function maybeShowInstallTip(): void {
  if (isStandalone() || state.settings.installTipDismissed) return;
  try {
    // Asking again on every reload is noise; once per browsing session is enough.
    if (window.sessionStorage.getItem(INSTALL_TIP_KEY) === 'seen') return;
  } catch {
    // Private mode may refuse sessionStorage; the tip is not critical.
  }
  window.setTimeout(() => {
    void confirmDialog({
      title: 'Keep Refaudio on your Home Screen',
      message:
        'In Safari, tap the Share button, then “Add to Home Screen”. Installed, Refaudio opens full-screen and your music stays on this device.',
      confirmLabel: 'Got it',
      cancelLabel: 'Later',
    }).then((acknowledged) => {
      try {
        window.sessionStorage.setItem(INSTALL_TIP_KEY, 'seen');
      } catch {
        // Ignore: worst case the tip appears again next reload.
      }
      if (acknowledged) void persist({ installTipDismissed: true });
    });
  }, 1600);
}

async function start(): Promise<void> {
  const mount = document.getElementById('app');
  if (!mount) return;

  // Before anything renders: the boot screen and shell are sized from it.
  watchViewportHeight();

  try {
    await bootstrapState();
  } catch (error) {
    showBootError(mount, error);
    return;
  }

  applyReduceTransparency(state.settings.reduceTransparency);

  const shell = createShell((tab) => setState({ tab }), openImportMenu);
  const library = createLibraryView();
  const playlists = createPlaylistsView();
  const settings = createSettingsView();
  const playerUI = createPlayerUI();

  shell.views.append(library.node, playlists.node, settings.node);
  shell.views.append(shell.toasts);
  shell.miniSlot.append(playerUI.mini);
  mount.replaceChildren(shell.root, playerUI.now);
  mountToasts(shell.toasts);

  const render = (): void => {
    for (const view of [library.node, playlists.node, settings.node]) {
      view.classList.toggle('is-active', view.id === `view-${state.tab}`);
    }
    shell.setTab(state.tab);

    if (state.tab === 'library') library.update();
    else if (state.tab === 'playlists') playlists.update();
    else settings.update();
  };

  subscribe(render);
  render();

  // Re-highlight the current row when the queue moves on.
  player.on('track', () => {
    if (state.tab === 'library') library.update();
    else if (state.tab === 'playlists') playlists.update();
  });

  restorePlayer();
  playerUI.sync();
  maybeShowInstallTip();
  void registerSW({
    immediate: true,
    onNeedRefresh() {
      toast('A new version is ready — close and reopen Refaudio to update.', 'info');
    },
    onOfflineReady() {
      toast('Refaudio is ready to work offline.', 'success');
    },
  });
}

on(document, 'keydown', (event) => {
  if (isEditable(event.target)) return;
  if (event.key === ' ') {
    event.preventDefault();
    player.toggle();
  }
});

void start();
