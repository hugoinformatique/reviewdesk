/**
 * Widget install platforms: pure data and URL builders, no React. Texts and
 * steps are those of the legacy admin (src/admin/app.ts), kept word for word.
 */

export type WidgetContext = {
  origin: string;
  projectId: string;
  token: string;
  previewOrigin: string;
  position: string;
  theme: string;
  label: string;
};

export type WidgetPlatform = {
  id: string;
  name: string;
  hint: string;
  badge: string;
  badgeHighlight?: boolean;
  /** Logo id, see platform-logos.tsx. */
  mark: string;
  where: string;
  /** Click-by-click, in the platform's own menu names. */
  steps: string[];
  /** A file the steps ask for, offered as a download next to them. */
  download?: { href: string; label: string };
  /** A link to send rather than code to paste. */
  isLink?: boolean;
  generate: (ctx: WidgetContext) => string;
};

/**
 * The widget reads its settings from the fragment of its own URL, so the whole
 * install is one URL. A fragment is never sent to the server: the reviewer
 * token stays out of access logs, and builders that only take a script URL
 * (or strip data-* attributes) still carry everything.
 */
export function widgetUrl({ origin, projectId, token, position, theme, label }: WidgetContext) {
  const params = new URLSearchParams({ project: projectId, token });
  if (position !== 'bottom-right') params.set('position', position);
  if (theme !== 'auto') params.set('theme', theme);
  if (label.trim()) params.set('label', label.trim());
  return `${origin}/widget.js#${params.toString().replace(/\+/g, '%20')}`;
}

export const widgetTag = (ctx: WidgetContext) => `<script src="${widgetUrl(ctx)}" defer></script>`;

/** The client-facing page that hands out the "Faire un retour" bookmark. */
export function reviewPageUrl(ctx: Pick<WidgetContext, 'origin' | 'projectId' | 'token' | 'previewOrigin'>) {
  const params = new URLSearchParams({ project: ctx.projectId, token: ctx.token });
  if (ctx.previewOrigin && ctx.previewOrigin !== ctx.origin) params.set('site', ctx.previewOrigin);
  return `${ctx.origin}/relecture.html#${params}`;
}

export const WIDGET_PLATFORMS: WidgetPlatform[] = [
  {
    id: 'wordpress',
    name: 'WordPress',
    hint: 'Extension à téléverser',
    badge: 'Le plus simple',
    badgeHighlight: true,
    mark: 'wordpress',
    where: 'Une extension à installer, une ligne à coller dans ses réglages. Aucun fichier du thème à modifier.',
    steps: [
      'Téléchargez l’extension ReviewDesk (bouton ci-dessous).',
      'Dans WordPress : Extensions › Ajouter › Téléverser une extension, choisissez le fichier, puis Activer.',
      'Réglages › ReviewDesk : collez la ligne ci-dessous et enregistrez.',
    ],
    download: { href: '/integrations/reviewdesk-wordpress.zip', label: 'Télécharger l’extension' },
    generate: widgetTag,
  },
  {
    id: 'webflow',
    name: 'Webflow',
    hint: 'Custom code',
    badge: 'Sans code',
    mark: 'webflow',
    where: 'Dans les réglages du site, pas dans une page : le bouton apparaît alors partout.',
    steps: [
      'Site settings › Custom code.',
      'Collez la ligne dans « Footer code » et enregistrez.',
      'Publiez le site : le code personnalisé n’apparaît qu’après publication.',
    ],
    generate: widgetTag,
  },
  {
    id: 'framer',
    name: 'Framer',
    hint: 'Custom Code',
    badge: 'Sans code',
    mark: 'framer',
    where: 'Dans les réglages du site : le bouton apparaît sur toutes les pages.',
    steps: [
      'Site Settings › General › Custom Code.',
      'Collez la ligne dans « End of <body> tag ».',
      'Publiez le site.',
    ],
    generate: widgetTag,
  },
  {
    id: 'wix',
    name: 'Wix',
    hint: 'Code personnalisé',
    badge: 'Sans code',
    mark: 'wix',
    where: 'Le code personnalisé de Wix demande un site publié sur un domaine connecté.',
    steps: [
      'Tableau de bord › Paramètres › Code personnalisé, puis « + Ajouter un code ».',
      'Collez la ligne, choisissez « Toutes les pages » et l’emplacement « Body - fin ».',
      'Appliquez, puis ouvrez le site publié.',
    ],
    generate: widgetTag,
  },
  {
    id: 'squarespace',
    name: 'Squarespace',
    hint: 'Injection de code',
    badge: 'Sans code',
    mark: 'squarespace',
    where: 'L’injection de code dépend de l’offre Squarespace du site.',
    steps: ['Paramètres › Avancé › Injection de code.', 'Collez la ligne dans « Pied de page » et enregistrez.'],
    generate: widgetTag,
  },
  {
    id: 'gtm',
    name: 'Tag Manager',
    hint: 'Balise HTML',
    badge: 'Sans déploiement',
    mark: 'gtm',
    where: 'Si le site charge déjà Google Tag Manager, inutile de toucher au site.',
    steps: [
      'Balises › Nouvelle › Configuration : « HTML personnalisé ».',
      'Collez la ligne ; déclencheur « All Pages » (ou limité au domaine de préproduction).',
      'Envoyez la version (Publier).',
    ],
    generate: widgetTag,
  },
  {
    id: 'html',
    name: 'HTML',
    hint: 'Balise <script>',
    badge: 'Universel',
    mark: 'html5',
    where: 'Juste avant </body>, sur chaque page à faire relire (ou dans le gabarit commun).',
    steps: ['Collez la ligne juste avant </body>.', 'Mettez le site en ligne et ouvrez-le.'],
    generate: (ctx) => `<!-- ReviewDesk : bouton de relecture -->\n${widgetTag(ctx)}`,
  },
  {
    id: 'nextjs',
    name: 'Next.js',
    hint: 'app/layout.tsx',
    badge: 'React',
    mark: 'react',
    where: 'Dans app/layout.tsx (App Router) ou pages/_app.tsx. Hors production uniquement.',
    steps: ['Ajoutez le composant Script à la mise en page racine.', 'Déployez la préproduction.'],
    generate: (ctx) =>
      `import Script from 'next/script';\n\n` +
      `export default function RootLayout({ children }: { children: React.ReactNode }) {\n` +
      `  return (\n` +
      `    <html lang="fr">\n` +
      `      <body>\n` +
      `        {children}\n` +
      `        {process.env.NODE_ENV !== 'production' && (\n` +
      `          <Script src="${widgetUrl(ctx)}" strategy="afterInteractive" />\n` +
      `        )}\n` +
      `      </body>\n` +
      `    </html>\n` +
      `  );\n` +
      `}`,
  },
  {
    id: 'direct',
    name: 'Sans installation',
    hint: 'Lien à envoyer',
    badge: 'Zéro code',
    mark: 'share-direct',
    where:
      'Rien à installer sur le site : le client ouvre ce lien et glisse le bouton « Faire un retour » dans ses favoris. Sur son site, un clic sur ce favori ouvre ReviewDesk. Ordinateur uniquement.',
    steps: [
      'Envoyez ce lien au client.',
      'Il glisse le bouton « Faire un retour » dans sa barre de favoris.',
      'Sur le site, un clic sur ce favori affiche le panneau de retour.',
    ],
    isLink: true,
    generate: reviewPageUrl,
  },
];


/** Default widget options: the URL only carries what differs from these. */
export const DEFAULT_WIDGET_OPTIONS = { position: 'bottom-right', theme: 'auto', label: '' } as const;

/** Ready-to-use context with the default options. */
export function widgetContext(args: {
  projectId: string;
  token: string;
  previewOrigin?: string;
  origin?: string;
  position?: string;
  theme?: string;
  label?: string;
}): WidgetContext {
  const origin = args.origin ?? location.origin;
  return {
    origin,
    projectId: args.projectId,
    token: args.token,
    previewOrigin: args.previewOrigin || origin,
    position: args.position ?? DEFAULT_WIDGET_OPTIONS.position,
    theme: args.theme ?? DEFAULT_WIDGET_OPTIONS.theme,
    label: args.label ?? DEFAULT_WIDGET_OPTIONS.label,
  };
}

/** Link to the demo page, token included (fragment only, never sent to a server). */
export function demoUrl(ctx: Pick<WidgetContext, 'origin' | 'projectId' | 'token'>) {
  return `/demo.html#api=${encodeURIComponent(ctx.origin)}&project=${ctx.projectId}&review=${ctx.token}`;
}
