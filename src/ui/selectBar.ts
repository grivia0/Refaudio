import { el, icon, type IconName } from './dom';

export interface SelectAction {
  /** Short visible label; the accessible name comes from `ariaLabel`. */
  label: string;
  ariaLabel: string;
  icon: IconName;
  tone?: 'primary' | 'danger';
  onSelect: () => void;
}

export interface SelectBar {
  node: HTMLElement;
  setVisible: (visible: boolean) => void;
  setCount: (selected: number, total: number) => void;
}

/**
 * Bottom action bar for multi-selection. Sits inside the view, just above the
 * tab bar, so the actions stay in thumb reach while the list scrolls.
 */
export function createSelectBar(options: {
  actions: SelectAction[];
  onDone: () => void;
  /** `selectAll` is false when everything listed is already ticked. */
  onToggleAll: (selectAll: boolean) => void;
}): SelectBar {
  const node = el('div', 'select-bar');
  node.hidden = true;

  const head = el('div', 'select-bar__head');
  const count = el('span', 'select-bar__count', 'Nothing selected');
  count.setAttribute('aria-live', 'polite');

  const links = el('div', 'select-bar__links');
  const all = el('button', 'select-bar__link', 'Select all');
  all.type = 'button';
  all.disabled = true;

  const done = el('button', 'select-bar__link select-bar__link--strong', 'Done');
  done.type = 'button';
  done.addEventListener('click', () => options.onDone());

  links.append(all, done);
  head.append(count, links);

  const actions = el('div', 'select-bar__actions');
  const buttons: HTMLButtonElement[] = [];
  for (const action of options.actions) {
    const button = el('button', `select-bar__btn${action.tone ? ` select-bar__btn--${action.tone}` : ''}`);
    button.type = 'button';
    button.setAttribute('aria-label', action.ariaLabel);
    button.disabled = true;
    button.append(icon(action.icon, { size: 17 }), el('span', undefined, action.label));
    button.addEventListener('click', () => action.onSelect());
    buttons.push(button);
    actions.append(button);
  }

  node.append(head, actions);

  let selected = 0;
  let total = 0;

  all.addEventListener('click', () => options.onToggleAll(selected < total));

  return {
    node,
    setVisible: (visible) => {
      node.hidden = !visible;
      if (!visible) {
        selected = 0;
        total = 0;
        count.textContent = 'Nothing selected';
        all.textContent = 'Select all';
        all.disabled = true;
        for (const button of buttons) button.disabled = true;
      }
    },
    setCount: (nextSelected, nextTotal) => {
      selected = nextSelected;
      total = nextTotal;
      count.textContent =
        selected === 0
          ? 'Nothing selected'
          : `${selected} ${selected === 1 ? 'song' : 'songs'} selected`;
      const everything = total > 0 && selected >= total;
      all.textContent = everything ? 'Clear' : 'Select all';
      all.disabled = total === 0;
      for (const button of buttons) button.disabled = selected === 0;
    },
  };
}
