import { addManyToQueue, player, playCollection, removeTracksFromLibrary } from '../app';
import { libraryRows, queueIds, type LibraryRow } from '../library';
import { persist, setState, state } from '../state';
import type { GroupMode, SortKey, TrackMeta } from '../types';
import { formatTime, plural, shuffled } from '../util';
import { el, icon, on } from './dom';
import { confirmDialog, toast } from './overlay';
import { createSelectBar } from './selectBar';
import { createTrackRow } from './trackRow';
import { openPlaylistPicker } from './trackMenu';
import { VirtualList } from './virtual';

const SORT_LABELS: Array<[SortKey, string]> = [
  ['added', 'Recently added'],
  ['title', 'Title'],
  ['artist', 'Artist'],
  ['album', 'Album'],
  ['duration', 'Longest first'],
];

const GROUP_LABELS: Array<[GroupMode, string]> = [
  ['none', 'No grouping'],
  ['album', 'By album'],
  ['artist', 'By artist'],
];

export interface LibraryView {
  node: HTMLElement;
  update: () => void;
}

function selectControl<Value extends string>(
  label: string,
  options: Array<[Value, string]>,
  current: Value,
  onChange: (value: Value) => void,
): HTMLSelectElement {
  const select = el('select');
  select.setAttribute('aria-label', label);
  for (const [value, text] of options) {
    const option = el('option', undefined, text);
    option.value = value;
    option.selected = value === current;
    select.append(option);
  }
  on(select, 'change', () => onChange(select.value as Value));
  return select;
}

export function createLibraryView(): LibraryView {
  const view = el('section', 'view');
  view.id = 'view-library';

  const head = el('div', 'library__head');
  const search = el('label', 'search');
  search.append(icon('search', { size: 18 }));

  const input = el('input');
  input.type = 'search';
  input.placeholder = 'Songs, albums, artists';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('enterkeyhint', 'search');
  search.append(input);

  const controls = el('div', 'controls');
  const playAll = el('button', 'chip chip--accent');
  playAll.type = 'button';
  playAll.append(icon('play', { size: 13 }), el('span', undefined, 'Play all'));

  const shuffleAll = el('button', 'chip');
  shuffleAll.type = 'button';
  shuffleAll.append(icon('shuffle', { size: 13 }), el('span', undefined, 'Shuffle'));

  const selectChip = el('button', 'chip');
  selectChip.type = 'button';
  selectChip.setAttribute('aria-pressed', 'false');
  selectChip.append(icon('check', { size: 13 }), el('span', undefined, 'Select'));
  selectChip.addEventListener('click', () => setSelecting(!selecting));

  const sortSelect = el('div', 'chip-select');
  sortSelect.append(
    selectControl('Sort by', SORT_LABELS, state.sort, (value) => {
      setState({ sort: value });
      void persist({ sort: value });
    }),
    icon('down', { size: 14 }),
  );

  const groupSelect = el('div', 'chip-select');
  groupSelect.append(
    selectControl('Group by', GROUP_LABELS, state.group, (value) => {
      setState({ group: value });
      void persist({ group: value });
    }),
    icon('down', { size: 14 }),
  );

  controls.append(playAll, shuffleAll, selectChip, sortSelect, groupSelect);
  head.append(search, controls);

  const meta = el('div', 'library__meta');
  const scroller = el('div', 'scroller');
  const emptyCard = el('div', 'empty-card');
  emptyCard.append(
    el('h3', undefined, 'Your library is empty'),
    el(
      'p',
      undefined,
      'Add music from the Files app on this iPhone, or pull files over Wi-Fi from your computer with the import button.',
    ),
  );

  let queue: string[] = [];
  let selecting = false;
  const selected = new Set<string>();

  /* ----------------------------- selection ------------------------------ */


  const bar = createSelectBar({
    actions: [
      {
        label: 'Playlist',
        ariaLabel: 'Add to playlist',
        icon: 'playlist',
        tone: 'primary',
        onSelect: () => addSelectionToPlaylist(),
      },
      {
        label: 'Queue',
        ariaLabel: 'Add to queue',
        icon: 'queue',
        onSelect: () => queueSelection(),
      },
      {
        label: 'Delete',
        ariaLabel: 'Delete selected songs',
        icon: 'trash',
        tone: 'danger',
        onSelect: () => void deleteSelection(),
      },
    ],
    onDone: () => setSelecting(false),
    onToggleAll: (selectAll) => {
      if (selectAll) for (const id of queue) selected.add(id);
      else selected.clear();
      list.refresh();
      syncBar();
    },
  });

  /** All ticked ids that still exist, in the order they were picked. */
  const selectedIds = (): string[] => [...selected].filter((id) => state.byId.has(id));

  const toggleSelect = (id: string): void => {
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    list.refresh();
    syncBar();
  };

  const syncBar = (): void => {
    bar.setCount(selected.size, queue.length);
  };

  function setSelecting(next: boolean): void {
    if (selecting === next) return;
    selecting = next;
    if (!selecting) selected.clear();

    selectChip.classList.toggle('is-active', selecting);
    selectChip.setAttribute('aria-pressed', selecting ? 'true' : 'false');
    selectChip.replaceChildren(
      icon(selecting ? 'close' : 'check', { size: 13 }),
      el('span', undefined, selecting ? 'Cancel' : 'Select'),
    );

    // Selection owns the action space; the sort/group chips would only crowd it.
    for (const control of [playAll, shuffleAll, sortSelect, groupSelect]) control.hidden = selecting;
    bar.setVisible(selecting);

    list.refresh();
    syncBar();
  }

  function addSelectionToPlaylist(): void {
    const tracks = selectedIds()
      .map((id) => state.byId.get(id))
      .filter((track): track is TrackMeta => track !== undefined);
    if (tracks.length === 0) {
      toast('Select at least one song first.');
      return;
    }
    openPlaylistPicker(tracks, { onAdded: () => setSelecting(false) });
  }

  function queueSelection(): void {
    const ids = selectedIds();
    if (ids.length === 0) {
      toast('Select at least one song first.');
      return;
    }
    const { added, started } = addManyToQueue(ids);
    setSelecting(false);
    if (started) toast(`Playing ${added} ${plural(added, 'song')}.`, 'success');
    else if (added === 0) toast('Already in the queue.', 'info');
    else toast(`Added ${added} ${plural(added, 'song')} to the queue.`, 'success');
  }

  async function deleteSelection(): Promise<void> {
    const ids = selectedIds();
    if (ids.length === 0) {
      toast('Select at least one song first.');
      return;
    }
    const confirmed = await confirmDialog({
      title: `Delete ${ids.length} ${plural(ids.length, 'song')}?`,
      message:
        'They will be removed from this device and from any playlists that contain them. This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return;

    const removed = await removeTracksFromLibrary(ids);
    setSelecting(false);
    toast(`${removed} ${plural(removed, 'song')} deleted.`, 'success');
  }

  /* ------------------------------- rows --------------------------------- */

  const renderRow = (row: LibraryRow): HTMLElement => {
    if (row.kind === 'header') {
      const node = el('div', 'group-head');
      node.append(el('span', 'group-head__title', row.title), el('span', 'group-head__sub', row.subtitle));
      return node;
    }
    return createTrackRow({
      track: row.track,
      queue,
      selectable: selecting,
      selected: selected.has(row.track.id),
      onSelect: toggleSelect,
    });
  };

  const list = new VirtualList<LibraryRow>({
    scroller,
    render: renderRow,
    heightFor: (row) => (row.kind === 'header' ? 44 : 64),
  });

  view.append(head, meta, emptyCard, scroller, bar.node);

  playAll.addEventListener('click', () => {
    if (selecting) return;
    if (queue.length > 0) playCollection(queue, queue[0]);
  });

  shuffleAll.addEventListener('click', () => {
    if (selecting || queue.length === 0) return;
    const shuffledQueue = shuffled(queue);
    playCollection(shuffledQueue, shuffledQueue[0]);
    if (!player.shuffle) {
      player.shuffle = true;
      void persist({ shuffle: true });
    }
  });

  let searchTimer = 0;
  on(input, 'input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      setState({ query: input.value });
      list.scrollToTop();
    }, 140);
  });

  // Escape leaves selection mode, unless a dialog or sheet is on top of it.
  on(document, 'keydown', (event) => {
    if (event.key !== 'Escape' || !selecting) return;
    if (document.querySelector('.modal, .sheet-overlay')) return;
    setSelecting(false);
  });

  const update = (): void => {
    if (input.value !== state.query) input.value = state.query;
    const rows = libraryRows(state.tracks, { query: state.query, sort: state.sort, group: state.group });
    queue = queueIds(rows);

    // Tracks can vanish under a selection (delete elsewhere, backup restore).
    for (const id of [...selected]) if (!state.byId.has(id)) selected.delete(id);

    const hasTracks = state.tracks.length > 0;
    emptyCard.hidden = hasTracks;
    scroller.hidden = !hasTracks;
    list.setItems(rows);

    if (!hasTracks && selecting) setSelecting(false);

    const totalSeconds = queue.reduce((sum, id) => sum + (state.byId.get(id)?.duration ?? 0), 0);
    const count = queue.length;
    meta.textContent = hasTracks
      ? `${count} ${plural(count, 'song')}${state.query ? ' matched' : ''} · ${formatTime(totalSeconds)}`
      : '';
    playAll.disabled = count === 0;
    shuffleAll.disabled = count === 0;
    syncBar();
  };

  return { node: view, update };
}

