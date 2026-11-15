import { clear, el, icon, iconButton, on } from './dom';

/* ------------------------------- toasts ------------------------------- */

let toastHost: HTMLElement | null = null;

export function mountToasts(host: HTMLElement): void {
  toastHost = host;
}

export function toast(message: string, tone: 'info' | 'success' | 'error' = 'info'): void {
  if (!toastHost) return;
  const node = el('div', `toast toast--${tone}`);
  const glyph = el('span', 'toast__icon');
  glyph.append(icon(tone === 'error' ? 'alert' : tone === 'success' ? 'check' : 'wifi', { size: 18 }));
  node.append(glyph, el('p', 'toast__text', message));
  toastHost.append(node);

  window.setTimeout(() => node.classList.add('is-out'), 4200);
  window.setTimeout(() => node.remove(), 4900);
}

/* ------------------------------- dialogs ------------------------------ */

interface DialogHandle {
  overlay: HTMLElement;
  body: HTMLElement;
  footer: HTMLElement;
  close: () => void;
}

function openDialog(title: string, dismissible = true): DialogHandle {
  const overlay = el('div', 'modal');
  const panel = el('div', 'modal__panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', title);

  const close = () => {
    document.removeEventListener('keydown', onKey);
    overlay.classList.add('is-closing');
    overlay.setAttribute('aria-hidden', 'true');
    window.setTimeout(() => overlay.remove(), 170);
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && dismissible) close();
  };

  const header = el('div', 'modal__head');
  header.append(el('h2', 'modal__title', title));
  if (dismissible) header.append(iconButton('close', 'Close', close));

  const body = el('div', 'modal__body');
  const footer = el('div', 'modal__footer');
  panel.append(header, body, footer);
  overlay.append(panel);

  document.addEventListener('keydown', onKey);
  if (dismissible) {
    on(overlay, 'click', (event) => {
      if (event.target === overlay) close();
    });
  }

  document.body.append(overlay);
  return { overlay, body, footer, close };
}

export function confirmDialog(options: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = openDialog(options.title);
    dialog.body.append(el('p', 'modal__text', options.message));

    const finish = (value: boolean) => {
      dialog.close();
      resolve(value);
    };

    const cancel = el('button', 'btn btn--ghost', options.cancelLabel ?? 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => finish(false));

    const ok = el('button', `btn ${options.danger ? 'btn--danger' : 'btn--primary'}`, options.confirmLabel ?? 'Confirm');
    ok.type = 'button';
    ok.addEventListener('click', () => finish(true));

    dialog.footer.append(cancel, ok);
  });
}

export function promptDialog(options: {
  title: string;
  label: string;
  value?: string;
  placeholder?: string;
  confirmLabel?: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = openDialog(options.title);
    const id = `field-${Math.random().toString(36).slice(2, 8)}`;
    const field = el('label', 'field');
    field.htmlFor = id;
    field.append(el('span', 'field__label', options.label));

    const input = el('input', 'field__input');
    input.id = id;
    input.type = 'text';
    input.value = options.value ?? '';
    input.placeholder = options.placeholder ?? '';
    input.autocomplete = 'off';
    input.setAttribute('enterkeyhint', 'done');
    field.append(input);
    dialog.body.append(field);

    const finish = (value: string | null) => {
      dialog.close();
      resolve(value);
    };

    const submit = () => {
      const value = input.value.trim();
      if (value) finish(value);
      else input.focus();
    };

    const cancel = el('button', 'btn btn--ghost', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => finish(null));

    const ok = el('button', 'btn btn--primary', options.confirmLabel ?? 'Save');
    ok.type = 'button';
    ok.addEventListener('click', submit);
    on(input, 'keydown', (event) => {
      if (event.key === 'Enter') submit();
    });

    dialog.footer.append(cancel, ok);
    window.setTimeout(() => input.focus(), 80);
  });
}

export interface ActionItem {
  label: string;
  hint?: string;
  danger?: boolean;
  onSelect: () => void;
}

/** iOS-style action sheet: every option is visible and at least 44 px tall. */
export function actionSheet(title: string, items: ActionItem[]): void {
  const overlay = el('div', 'sheet-overlay');
  const panel = el('div', 'action-sheet');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', title);
  panel.append(el('p', 'action-sheet__title', title));

  const close = () => {
    overlay.classList.add('is-closing');
    overlay.setAttribute('aria-hidden', 'true');
    window.setTimeout(() => overlay.remove(), 170);
  };

  for (const item of items) {
    const node = el('button', `action-sheet__item${item.danger ? ' is-danger' : ''}`);
    node.type = 'button';
    node.append(el('span', 'action-sheet__label', item.label));
    if (item.hint) node.append(el('span', 'action-sheet__hint', item.hint));
    node.addEventListener('click', () => {
      close();
      item.onSelect();
    });
    panel.append(node);
  }

  const cancel = el('button', 'action-sheet__item action-sheet__item--cancel', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', close);
  panel.append(cancel);

  overlay.append(panel);
  on(overlay, 'click', (event) => {
    if (event.target === overlay) close();
  });
  document.body.append(overlay);
}

/* ------------------------------ progress ------------------------------ */

export interface ProgressDialog {
  setLabel: (label: string) => void;
  setDetail: (detail: string) => void;
  setValue: (done: number, total: number) => void;
  close: () => void;
}

export function progressDialog(options: {
  title: string;
  label?: string;
  onCancel?: () => void;
}): ProgressDialog {
  const dialog = openDialog(options.title, false);
  const label = el('p', 'progress__label', options.label ?? 'Working…');
  const detail = el('p', 'progress__detail', '');
  const track = el('div', 'progress__track');
  const bar = el('div', 'progress__bar');
  track.append(bar);
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');
  dialog.body.append(label, detail, track);

  if (options.onCancel) {
    const cancel = el('button', 'btn btn--ghost', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => options.onCancel?.());
    dialog.footer.append(cancel);
  }

  return {
    setLabel: (text) => {
      label.textContent = text;
    },
    setDetail: (text) => {
      detail.textContent = text;
    },
    setValue: (done, total) => {
      const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
      bar.style.width = `${pct}%`;
      track.setAttribute('aria-valuenow', String(pct));
    },
    close: dialog.close,
  };
}

/* ------------------------------ list sheet ---------------------------- */

export interface ListSheetHandle {
  list: HTMLElement;
  footer: HTMLElement;
  close: () => void;
}

/** Bottom sheet with a scrolling list; used by the queue and the inbox picker. */
export function listSheet(options: { title: string; empty: string; onClose?: () => void }): ListSheetHandle {
  const overlay = el('div', 'sheet-overlay');
  const panel = el('div', 'sheet-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', options.title);

  const head = el('div', 'sheet-panel__head');
  const close = () => {
    overlay.classList.add('is-closing');
    overlay.setAttribute('aria-hidden', 'true');
    window.setTimeout(() => overlay.remove(), 200);
    options.onClose?.();
  };
  head.append(el('h2', 'sheet-panel__title', options.title), iconButton('close', 'Close', close));

  const list = el('div', 'sheet-panel__list');
  const footer = el('div', 'sheet-panel__footer');
  list.append(el('p', 'empty', options.empty));

  panel.append(head, list, footer);
  overlay.append(panel);
  on(overlay, 'click', (event) => {
    if (event.target === overlay) close();
  });
  document.body.append(overlay);

  return { list, footer, close };
}

export function resetList(list: HTMLElement, emptyMessage: string, empty: boolean): void {
  clear(list);
  if (empty) list.append(el('p', 'empty', emptyMessage));
}

/** Read-only details dialog (tags, file info, storage size). */
export function detailDialog(title: string, rows: Array<[string, string]>): void {
  const dialog = openDialog(title);
  const list = el('dl', 'kv');
  for (const [key, value] of rows) {
    list.append(el('dt', undefined, key), el('dd', undefined, value));
  }
  dialog.body.append(list);

  const done = el('button', 'btn btn--primary', 'Done');
  done.type = 'button';
  done.addEventListener('click', dialog.close);
  dialog.footer.append(done);
}
