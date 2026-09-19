import { accentTokens, contrastRatio, normaliseHex, parseHex } from '../brand-tokens.js';
import { applyBranding, splitWordmark, type PublicBranding } from './branding.js';

/**
 * The white-label setup wizard.
 *
 * This instance is sold on: an agency deploys it, signs in once, and everything
 * it sees afterwards should carry the agency's name. That first sign-in is the
 * only moment where asking for an identity is not an interruption, so the
 * wizard takes it over completely rather than hiding in a settings page — and
 * shows the result the whole time, because picking a brand colour from a hex
 * field with no preview is guesswork.
 */

const MAX_LOGO_BYTES = 96 * 1024;
const LOGO_MIMES = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp'];

export type BrandingDraft = {
  productName: string;
  tagline: string;
  logoDataUri: string | null;
  accent: string;
  publicUrl: string;
  emailFromName: string;
  emailFromAddress: string;
  emailReplyTo: string;
};

export type SetupOptions = {
  /** 'first-run' takes over the screen; 'settings' is the same flow, reopened. */
  mode: 'first-run' | 'settings';
  draft: BrandingDraft;
  emailDeliveryNote: string;
  /** Persists the draft. Resolves with what the server stored. */
  save: (draft: BrandingDraft, completeSetup: boolean) => Promise<PublicBranding>;
  /** Called once the wizard closes, with the branding in force. */
  onClose: (branding: PublicBranding | null) => void;
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function icon(id: string, className = 'icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

/** A well-drawn SVG logo weighs a few hundred bytes; « 0 Ko » reads as a failure. */
const fileSize = (bytes: number) => (bytes < 1024 ? `${bytes} o` : `${Math.round(bytes / 1024)} Ko`);

function field(label: string, hint: string, control: HTMLElement) {
  const wrap = el('div', 'setup-field');
  const name = el('label', 'setup-label', label);
  if (control.id) name.setAttribute('for', control.id);
  wrap.append(name, control);
  if (hint) wrap.append(el('p', 'setup-hint', hint));
  return wrap;
}

function textInput(id: string, value: string, placeholder: string, attrs: Record<string, string> = {}) {
  const input = el('input', 'setup-input');
  input.id = id;
  input.value = value;
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  for (const [key, attr] of Object.entries(attrs)) input.setAttribute(key, attr);
  return input;
}

/**
 * Presets exist so nobody has to type a hex to get a defensible result. The
 * first one is the stock ink, which is the only value that keeps the interface
 * monochrome and inverts by itself between light and dark.
 */
const PRESETS: { value: string; label: string }[] = [
  { value: '#18181b', label: 'Encre (par défaut)' },
  { value: '#2563eb', label: 'Bleu' },
  { value: '#4f46e5', label: 'Indigo' },
  { value: '#7c3aed', label: 'Violet' },
  { value: '#0d9488', label: 'Sarcelle' },
  { value: '#059669', label: 'Émeraude' },
  { value: '#ea580c', label: 'Orange' },
  { value: '#e11d48', label: 'Rose' },
];

type Step = {
  id: string;
  /** Shown in the progress rail. */
  short: string;
  eyebrow: string;
  title: string;
  intro: string;
  render: () => HTMLElement;
  /** Returns an error message to block « Continuer », or null. */
  validate?: () => string | null;
};

export function openSetup(options: SetupOptions): void {
  const mounted = document.querySelector<HTMLElement>('#setup');
  if (!mounted) return;
  const host: HTMLElement = mounted;

  const draft: BrandingDraft = { ...options.draft };
  let index = 0;
  let saving = false;
  let saved: PublicBranding | null = null;

  // ------------------------------------------------------------------ preview

  const stage = el('div', 'setup-stage');
  const stageInner = el('div', 'stage-frame');
  stage.append(el('p', 'stage-caption', 'Aperçu en direct'), stageInner);

  /**
   * The preview is coloured through its own element rather than `:root`, so the
   * surrounding wizard keeps the interface accent until the draft is actually
   * saved. Nothing outside this box changes while somebody is still deciding.
   */
  function paintStage() {
    const tokens = accentTokens(draft.accent);
    const dark =
      document.documentElement.dataset.theme === 'dark' ||
      (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    stageInner.style.setProperty('--accent', tokens.accent);
    stageInner.style.setProperty('--accent-hover', tokens.accentHover);
    stageInner.style.setProperty('--accent-fg', tokens.accentFg);
    stageInner.style.setProperty('--accent-soft', tokens.accentSoft);
    stageInner.style.setProperty('--ring', tokens.ring);
    stageInner.style.setProperty('--accent-text', dark ? tokens.accentOnDark : tokens.accentOnLight);

    stageInner.textContent = '';
    const { light, bold } = splitWordmark(draft.productName || 'ReviewDesk');

    const mark = el('span', 'mark stage-mark');
    if (draft.logoDataUri) {
      mark.classList.add('has-logo');
      const img = el('img', 'mark-img');
      img.src = draft.logoDataUri;
      img.alt = '';
      mark.append(img);
    } else {
      mark.append(icon('i-brand'));
    }
    const wordmark = el('span', 'wordmark');
    if (light) wordmark.append(el('span', '', light));
    wordmark.append(el('b', '', bold));

    const nav = el('div', 'stage-nav');
    const brand = el('div', 'brand');
    brand.append(mark, wordmark);
    const tabs = el('div', 'stage-tabs');
    const active = el('span', 'stage-tab is-active', 'Vue d’ensemble');
    tabs.append(active, el('span', 'stage-tab', 'Retours'));
    nav.append(brand, tabs);

    const head = el('div', 'stage-head');
    const titles = el('div');
    titles.append(el('span', 'stage-eyebrow', 'TOUS LES CLIENTS'), el('h3', 'stage-title', 'Tous les retours'));
    const cta = el('button', 'stage-btn', 'Nouveau projet');
    cta.type = 'button';
    cta.tabIndex = -1;
    head.append(titles, cta);

    const cards = el('div', 'stage-kpis');
    for (const [label, value] of [
      ['Retours ouverts', '12'],
      ['Délai médian', '3 h 20'],
    ] as const) {
      const card = el('div', 'stage-kpi');
      card.append(el('span', 'stage-kpi-label', label), el('strong', 'stage-kpi-value', value));
      cards.append(card);
    }

    const row = el('div', 'stage-row');
    const pin = el('span', 'stage-pin');
    pin.append(icon('i-pin'));
    const rowText = el('div', 'stage-row-text');
    rowText.append(
      el('strong', '', 'Le bouton du panier est coupé sur mobile'),
      el('span', '', 'boutique.client.fr — il y a 2 h'),
    );
    row.append(pin, rowText, el('span', 'stage-badge', 'À FAIRE'));

    const page = el('div', 'stage-page');
    page.append(head, cards, row);

    const launcher = el('div', 'stage-launcher');
    launcher.append(icon('i-brand'), el('span', '', 'Faire un retour'));

    stageInner.append(nav, page, launcher);
  }

  // -------------------------------------------------------------------- steps

  function welcomeStep() {
    const box = el('div', 'setup-welcome');
    const points: [string, string, string][] = [
      ['i-image', 'Votre logo et votre nom', 'Sur l’écran de connexion, dans le tableau de bord, et jusque dans les extraits d’installation remis à vos clients.'],
      ['i-target', 'Votre couleur', 'Une seule teinte à choisir : les états survolés, le texte posé dessus et l’anneau de focus en sont déduits, avec un contraste garanti.'],
      ['i-link', 'Votre domaine', 'L’adresse publique de cette instance, utilisée dans le code que vous livrez.'],
    ];
    for (const [iconId, title, body] of points) {
      const item = el('div', 'setup-point');
      const bullet = el('span', 'setup-point-icon');
      bullet.append(icon(iconId));
      const text = el('div');
      text.append(el('strong', '', title), el('p', '', body));
      item.append(bullet, text);
      box.append(item);
    }
    return box;
  }

  function identityStep() {
    const box = el('div', 'setup-fields');

    const name = textInput('setup-name', draft.productName, 'Acme Feedback', { maxlength: '40' });
    name.addEventListener('input', () => {
      draft.productName = name.value;
      paintStage();
      syncFooter();
    });

    const tagline = textInput('setup-tagline', draft.tagline, 'Ce que vos clients lisent en se connectant', {
      maxlength: '200',
    });
    tagline.addEventListener('input', () => {
      draft.tagline = tagline.value;
    });

    box.append(
      field('Nom du produit', 'Remplace « ReviewDesk » partout dans l’interface.', name),
      field('Baseline', 'Une phrase sous le logo, sur l’écran de connexion.', tagline),
      field('Logo', `SVG, PNG, JPEG ou WebP — ${Math.round(MAX_LOGO_BYTES / 1024)} Ko maximum.`, logoPicker()),
    );
    return box;
  }

  function logoPicker() {
    const zone = el('div', 'logo-zone');
    const input = el('input');
    input.type = 'file';
    input.accept = LOGO_MIMES.join(',');
    input.className = 'visually-hidden';
    input.id = 'setup-logo';

    const status = el('p', 'setup-hint logo-status');

    const render = () => {
      zone.classList.toggle('has-logo', Boolean(draft.logoDataUri));
      preview.textContent = '';
      if (draft.logoDataUri) {
        const img = el('img', 'logo-preview-img');
        img.src = draft.logoDataUri;
        img.alt = 'Logo de l’instance';
        preview.append(img);
        clear.hidden = false;
        label.textContent = 'Remplacer le logo';
      } else {
        preview.append(icon('i-image', 'icon logo-placeholder'));
        clear.hidden = true;
        label.textContent = 'Choisir un fichier ou le déposer ici';
      }
      paintStage();
    };

    const preview = el('div', 'logo-preview');
    const label = el('span', 'logo-label');
    const clear = el('button', 'btn btn-ghost logo-clear', 'Retirer');
    clear.type = 'button';
    clear.hidden = true;
    clear.addEventListener('click', (event) => {
      event.stopPropagation();
      draft.logoDataUri = null;
      status.textContent = '';
      input.value = '';
      render();
    });

    const accept = (file: File | undefined) => {
      if (!file) return;
      if (!LOGO_MIMES.includes(file.type)) {
        status.textContent = 'Format non pris en charge : utilisez un SVG, un PNG, un JPEG ou un WebP.';
        return;
      }
      if (file.size > MAX_LOGO_BYTES) {
        status.textContent = `Fichier trop lourd (${fileSize(file.size)}) : la limite est de ${fileSize(MAX_LOGO_BYTES)}.`;
        return;
      }
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        draft.logoDataUri = String(reader.result);
        status.textContent = `${file.name} — ${fileSize(file.size)}`;
        render();
      });
      reader.addEventListener('error', () => {
        status.textContent = 'Lecture du fichier impossible.';
      });
      reader.readAsDataURL(file);
    };

    input.addEventListener('change', () => accept(input.files?.[0]));
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        input.click();
      }
    });
    zone.addEventListener('dragover', (event) => {
      event.preventDefault();
      zone.classList.add('is-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
    zone.addEventListener('drop', (event) => {
      event.preventDefault();
      zone.classList.remove('is-over');
      accept(event.dataTransfer?.files?.[0]);
    });

    zone.tabIndex = 0;
    zone.setAttribute('role', 'button');
    zone.append(preview, label, clear, input);

    const wrap = el('div');
    wrap.append(zone, status);
    render();
    return wrap;
  }

  function accentStep() {
    const box = el('div', 'setup-fields');

    const swatches = el('div', 'swatches');
    const hexInput = textInput('setup-accent', draft.accent, '#2563eb', { maxlength: '7', spellcheck: 'false' });
    hexInput.classList.add('mono');

    const picker = el('input', 'color-picker');
    picker.type = 'color';
    picker.value = draft.accent;
    picker.setAttribute('aria-label', 'Sélecteur de couleur');

    const readout = el('p', 'contrast-readout');

    const syncReadout = () => {
      const tokens = accentTokens(draft.accent);
      const background = parseHex(tokens.accent);
      const foreground = parseHex(tokens.accentFg);
      if (!background || !foreground) return;
      const ratio = contrastRatio(background, foreground);
      const onWhite = tokens.accentFg === '#ffffff';
      readout.className = `contrast-readout ${ratio >= 4.5 ? 'ok' : 'warn'}`;
      readout.textContent =
        `Texte ${onWhite ? 'blanc' : 'noir'} sur cette couleur : contraste ${ratio.toFixed(1)}:1 — ` +
        (ratio >= 4.5 ? 'conforme AA.' : 'sous le seuil AA de 4,5:1, à éviter pour les boutons pleins.');
    };

    const setAccent = (value: string, from?: HTMLInputElement) => {
      const normalised = normaliseHex(value);
      if (!normalised) return;
      draft.accent = normalised;
      if (from !== hexInput) hexInput.value = normalised;
      if (from !== picker) picker.value = normalised;
      for (const swatch of swatches.querySelectorAll<HTMLElement>('.swatch')) {
        swatch.setAttribute('aria-pressed', String(swatch.dataset.value === normalised));
      }
      syncReadout();
      paintStage();
    };

    for (const preset of PRESETS) {
      const swatch = el('button', 'swatch');
      swatch.type = 'button';
      swatch.dataset.value = preset.value;
      swatch.title = preset.label;
      swatch.setAttribute('aria-label', preset.label);
      swatch.setAttribute('aria-pressed', String(preset.value === draft.accent));
      swatch.style.setProperty('--swatch', preset.value);
      swatch.append(icon('i-check', 'icon swatch-check'));
      swatch.addEventListener('click', () => setAccent(preset.value));
      swatches.append(swatch);
    }

    hexInput.addEventListener('input', () => setAccent(hexInput.value, hexInput));
    picker.addEventListener('input', () => setAccent(picker.value, picker));

    const custom = el('div', 'accent-custom');
    custom.append(picker, hexInput);

    box.append(
      field('Couleur de marque', 'Une teinte suffit : tout le reste en est déduit.', swatches),
      field('Valeur exacte', '', custom),
    );
    box.append(readout);
    syncReadout();
    return box;
  }

  function reachStep() {
    const box = el('div', 'setup-fields');

    const url = textInput('setup-url', draft.publicUrl, 'https://retours.mon-agence.fr', { inputmode: 'url' });
    url.addEventListener('input', () => {
      draft.publicUrl = url.value.trim();
    });

    const fromName = textInput('setup-from-name', draft.emailFromName, 'Support Acme', { maxlength: '80' });
    fromName.addEventListener('input', () => {
      draft.emailFromName = fromName.value;
    });

    const fromAddress = textInput('setup-from-address', draft.emailFromAddress, 'support@mon-agence.fr', {
      type: 'email',
    });
    fromAddress.addEventListener('input', () => {
      draft.emailFromAddress = fromAddress.value.trim();
    });

    const replyTo = textInput('setup-reply-to', draft.emailReplyTo, 'equipe@mon-agence.fr', { type: 'email' });
    replyTo.addEventListener('input', () => {
      draft.emailReplyTo = replyTo.value.trim();
    });

    const note = el('div', 'setup-note');
    note.append(icon('i-plug'), el('p', '', options.emailDeliveryNote));

    box.append(
      field(
        'Adresse publique de l’instance',
        'Reprise dans les extraits d’installation que vous remettez à vos clients.',
        url,
      ),
      el('hr', 'setup-sep'),
      field('Nom de l’expéditeur', '', fromName),
      field('Adresse d’expédition', '', fromAddress),
      field('Adresse de réponse', 'Facultative : où arrivent les réponses de vos clients.', replyTo),
      note,
    );
    return box;
  }

  function doneStep() {
    const box = el('div', 'setup-fields');
    const list = el('dl', 'setup-recap');
    const rows: [string, string][] = [
      ['Nom', draft.productName],
      ['Logo', draft.logoDataUri ? 'Personnalisé' : 'Marque par défaut'],
      ['Couleur', draft.accent],
      ['Adresse publique', draft.publicUrl || 'Non renseignée'],
      ['Expéditeur', draft.emailFromAddress || 'Non renseigné'],
    ];
    for (const [label, value] of rows) {
      list.append(el('dt', '', label), el('dd', value === draft.accent ? 'mono' : '', value));
    }
    box.append(list, el('p', 'setup-hint', 'Tout reste modifiable plus tard depuis Personnalisation.'));
    return box;
  }

  const steps: Step[] = [
    {
      id: 'welcome',
      short: 'Bienvenue',
      eyebrow: 'MISE EN ROUTE',
      title: 'Cette instance est la vôtre',
      intro:
        'Quatre écrans pour la mettre à vos couleurs. Vos clients ne verront jamais un autre nom que le vôtre.',
      render: welcomeStep,
    },
    {
      id: 'identity',
      short: 'Identité',
      eyebrow: 'ÉTAPE 1',
      title: 'Nom et logo',
      intro: 'Ce que vos clients lisent en arrivant, et ce qui signe les extraits que vous leur livrez.',
      render: identityStep,
      validate: () => (draft.productName.trim() ? null : 'Donnez un nom à votre produit.'),
    },
    {
      id: 'accent',
      short: 'Couleur',
      eyebrow: 'ÉTAPE 2',
      title: 'Votre couleur',
      intro: 'Choisissez une teinte : les variations et le contraste du texte en sont déduits automatiquement.',
      render: accentStep,
      validate: () => (normaliseHex(draft.accent) ? null : 'Cette couleur n’est pas un code hexadécimal valide.'),
    },
    {
      id: 'reach',
      short: 'Diffusion',
      eyebrow: 'ÉTAPE 3',
      title: 'Domaine et expéditeur',
      intro: 'L’adresse où vit cette instance, et l’identité sous laquelle elle écrira à vos clients.',
      render: reachStep,
      validate: () => {
        if (draft.publicUrl && !/^https?:\/\/.+/i.test(draft.publicUrl)) {
          return 'L’adresse publique doit commencer par http:// ou https://.';
        }
        const valid = (value: string) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
        if (!valid(draft.emailFromAddress) || !valid(draft.emailReplyTo)) return 'Vérifiez les adresses email.';
        return null;
      },
    },
    {
      id: 'done',
      short: 'Terminé',
      eyebrow: 'ÉTAPE 4',
      title: 'Tout est prêt',
      intro: 'Relisez, puis appliquez. Le tableau de bord s’ouvre à vos couleurs.',
      render: doneStep,
    },
  ];

  // ------------------------------------------------------------------- chrome

  const progress = el('div', 'setup-progress');
  const stepTitle = el('h2', 'setup-title');
  const stepEyebrow = el('span', 'setup-eyebrow');
  const stepIntro = el('p', 'setup-intro');
  const body = el('div', 'setup-body');
  const error = el('p', 'setup-error');
  error.setAttribute('role', 'alert');

  const back = el('button', 'btn btn-ghost', 'Retour');
  back.type = 'button';
  const next = el('button', 'btn btn-primary', 'Continuer');
  next.type = 'button';
  const later = el('button', 'btn btn-ghost setup-later', 'Configurer plus tard');
  later.type = 'button';

  const actions = el('div', 'setup-actions');
  actions.append(back, el('div', 'setup-spacer'), later, next);

  const panel = el('section', 'setup-panel');
  const header = el('header', 'setup-header');
  header.append(stepEyebrow, stepTitle, stepIntro);
  panel.append(progress, header, body, error, actions);

  const grid = el('div', 'setup-grid');
  grid.append(panel, stage);

  function syncFooter() {
    const isLast = index === steps.length - 1;
    next.textContent = saving ? 'Application…' : isLast ? 'Appliquer et ouvrir' : 'Continuer';
    next.disabled = saving;
    back.hidden = index === 0;
    // In settings mode nothing is pending, so the escape hatch is « Fermer »;
    // on a first run it is a genuine « later », which leaves setup incomplete.
    later.textContent = options.mode === 'settings' ? 'Fermer' : 'Configurer plus tard';
    later.hidden = saving;
    for (const [position, dot] of [...progress.children].entries()) {
      dot.className = `progress-step${position === index ? ' is-current' : ''}${position < index ? ' is-done' : ''}`;
    }
  }

  function renderStep() {
    const step = steps[index]!;
    stepEyebrow.textContent = step.eyebrow;
    stepTitle.textContent = step.title;
    stepIntro.textContent = step.intro;
    error.textContent = '';
    body.textContent = '';
    body.append(step.render());
    body.dataset.step = step.id;
    syncFooter();
    // Moving between steps re-announces the heading rather than dumping focus
    // at the top of the document.
    stepTitle.setAttribute('tabindex', '-1');
    stepTitle.focus({ preventScroll: true });
  }

  for (const step of steps) {
    const dot = el('span', 'progress-step');
    dot.title = step.short;
    progress.append(dot);
  }

  async function commit() {
    saving = true;
    syncFooter();
    try {
      const branding = await options.save(draft, true);
      saved = branding;
      applyBranding(branding);
      close();
    } catch {
      saving = false;
      syncFooter();
      error.textContent = 'Enregistrement impossible. Vérifiez votre connexion, puis réessayez.';
    }
  }

  next.addEventListener('click', async () => {
    const step = steps[index]!;
    const message = step.validate?.() ?? null;
    if (message) {
      error.textContent = message;
      return;
    }
    if (index === steps.length - 1) return commit();
    index += 1;
    renderStep();
  });

  back.addEventListener('click', () => {
    if (index === 0) return;
    index -= 1;
    renderStep();
  });

  later.addEventListener('click', () => close());

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && options.mode === 'settings') {
      event.preventDefault();
      close();
    }
  }

  function close() {
    document.removeEventListener('keydown', onKeydown);
    host.textContent = '';
    host.hidden = true;
    document.body.classList.remove('setup-open');
    options.onClose(saved);
  }

  host.textContent = '';
  host.hidden = false;
  host.append(grid);
  document.body.classList.add('setup-open');
  document.addEventListener('keydown', onKeydown);
  paintStage();
  renderStep();
}
