import type { TabKey } from '../state';
import { el, icon, type IconName } from './dom';

export interface Shell {
  root: HTMLElement;
  views: HTMLElement;
  miniSlot: HTMLElement;
  toasts: HTMLElement;
  setTab: (tab: TabKey) => void;
}

const TABS: Array<{ key: TabKey; label: string; icon: IconName }> = [
  { key: 'library', label: 'Library', icon: 'library' },
  { key: 'playlists', label: 'Playlists', icon: 'playlist' },
  { key: 'settings', label: 'Settings', icon: 'settings' },
];

export function createShell(onTab: (tab: TabKey) => void, onImport: () => void): Shell {
  const root = el('div', 'app');

  const topbar = el('header', 'topbar');
  const brand = el('div', 'brand');
  brand.append(el('span', 'brand__mark'), el('span', 'brand__name', 'Refaudio'));

  const actions = el('div', 'topbar__actions');
  const importBtn = el('button', 'icon-btn icon-btn--accent');
  importBtn.type = 'button';
  importBtn.setAttribute('aria-label', 'Add music');
  importBtn.append(icon('plus'));
  importBtn.addEventListener('click', onImport);
  actions.append(importBtn);
  topbar.append(brand, actions);

  const views = el('main', 'views');

  const footer = el('div', 'app__footer');
  const miniSlot = el('div');
  const tabbar = el('nav', 'tabbar');
  tabbar.setAttribute('role', 'tablist');
  tabbar.setAttribute('aria-label', 'Sections');

  const buttons = new Map<TabKey, HTMLButtonElement>();
  for (const tab of TABS) {
    const button = el('button', 'tab');
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.dataset.tab = tab.key;
    const iconHost = el('span', 'tab__icon');
    iconHost.append(icon(tab.icon, { size: 21 }));
    button.append(iconHost, el('span', undefined, tab.label));
    button.addEventListener('click', () => onTab(tab.key));
    buttons.set(tab.key, button);
    tabbar.append(button);
  }

  footer.append(miniSlot, tabbar);
  root.append(topbar, views, footer);

  const toasts = el('div', 'toasts');
  toasts.setAttribute('aria-live', 'polite');
  toasts.setAttribute('aria-atomic', 'false');

  const setTab = (tab: TabKey): void => {
    for (const [key, button] of buttons) {
      const active = key === tab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    }
  };

  return { root, views, miniSlot, toasts, setTab };
}
