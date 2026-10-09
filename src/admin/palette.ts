/**
 * Command palette (⌘K / Ctrl+K): one field that reaches every view, project,
 * recent ticket and action without leaving the keyboard.
 *
 * The palette knows nothing about the app: it is handed a function that lists
 * the current items, and each item carries its own `run`. Markup is built with
 * textContent only, since ticket text is reviewer input stored verbatim.
 */

export type PaletteItem = {
  group: string;
  label: string;
  hint?: string;
  /** Extra words the item answers to, never displayed. */
  keywords?: string;
  leading?: () => Element;
  run: () => void;
};

/** Case- and accent-insensitive, so "reglages" finds "Réglages". */
function fold(text: string) {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function matches(item: PaletteItem, words: string[]) {
  const haystack = fold(`${item.label} ${item.hint ?? ''} ${item.keywords ?? ''} ${item.group}`);
  return words.every((word) => haystack.includes(word));
}

export function initPalette(list: () => PaletteItem[]) {
  const dialog = document.querySelector<HTMLDialogElement>('#palette')!;
  const input = dialog.querySelector<HTMLInputElement>('#palette-input')!;
  const results = dialog.querySelector<HTMLElement>('#palette-list')!;
  let shown: PaletteItem[] = [];
  let active = 0;

  // ⌘ means nothing on Windows or Linux; say the key they actually press.
  if (!/Mac|iPhone|iPad/.test(navigator.userAgent)) {
    for (const key of document.querySelectorAll('kbd')) {
      if (key.textContent === '⌘K') key.textContent = 'Ctrl K';
    }
  }

  function setActive(index: number) {
    if (!shown.length) return;
    active = (index + shown.length) % shown.length;
    for (const option of results.querySelectorAll('[role="option"]')) {
      option.setAttribute('aria-selected', String(option.id === `palette-opt-${active}`));
    }
    input.setAttribute('aria-activedescendant', `palette-opt-${active}`);
    results.querySelector(`#palette-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
  }

  function render() {
    const words = fold(input.value.trim()).split(/\s+/).filter(Boolean);
    shown = list().filter((item) => matches(item, words));
    results.replaceChildren();
    if (!shown.length) {
      const empty = document.createElement('p');
      empty.className = 'palette-empty';
      empty.textContent = 'Aucun résultat.';
      results.append(empty);
      input.removeAttribute('aria-activedescendant');
      return;
    }
    let group = '';
    shown.forEach((item, index) => {
      if (item.group !== group) {
        group = item.group;
        const heading = document.createElement('div');
        heading.className = 'palette-group';
        heading.setAttribute('role', 'presentation');
        heading.textContent = group;
        results.append(heading);
      }
      const option = document.createElement('div');
      option.id = `palette-opt-${index}`;
      option.className = 'palette-option';
      option.setAttribute('role', 'option');
      if (item.leading) option.append(item.leading());
      const label = document.createElement('span');
      label.className = 'palette-label';
      label.textContent = item.label;
      option.append(label);
      if (item.hint) {
        const hint = document.createElement('span');
        hint.className = 'palette-hint';
        hint.textContent = item.hint;
        option.append(hint);
      }
      // mousedown, not click: the input keeps focus, so nothing flickers.
      option.addEventListener('mousedown', (event) => {
        event.preventDefault();
        choose(index);
      });
      option.addEventListener('mousemove', () => {
        if (active !== index) setActive(index);
      });
      results.append(option);
    });
    setActive(0);
  }

  function choose(index: number) {
    const item = shown[index];
    if (!item) return;
    dialog.close();
    item.run();
  }

  function open() {
    if (dialog.open) return;
    input.value = '';
    render();
    dialog.showModal();
    input.focus();
  }

  input.addEventListener('input', render);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') setActive(active + 1);
    else if (event.key === 'ArrowUp') setActive(active - 1);
    else if (event.key === 'Home' && event.ctrlKey) setActive(0);
    else if (event.key === 'End' && event.ctrlKey) setActive(shown.length - 1);
    else if (event.key === 'Enter') choose(active);
    else return;
    event.preventDefault();
  });
  // A click on the backdrop lands on the dialog element itself.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey) || event.altKey) return;
    if (document.querySelector<HTMLElement>('#app')?.hidden) return;
    // The first-run setup is a full-screen overlay of its own.
    if (document.querySelector<HTMLElement>('#setup')?.hidden === false) return;
    // Another modal owns the screen; the palette would stack on top of it.
    if (!dialog.open && document.querySelector('dialog[open]')) return;
    event.preventDefault();
    if (dialog.open) dialog.close();
    else open();
  });

  return { open };
}
