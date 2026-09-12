import { normalizeDiagnostics } from '../privacy.js';

type Init = {
  api: string;
  projectId: string;
  token: string;
  /** Wording of the launcher, for sites that already say "avis" or "feedback". */
  label?: string;
  position?: 'bottom-right' | 'bottom-left';
  /** `auto` reads the host page's own background; `light`/`dark` force it. */
  theme?: 'auto' | 'light' | 'dark';
  /** Accent colour, so the widget can sit inside the client's own palette. */
  accent?: string;
};

const UPLOAD_MAX_BYTES = 4_000_000;

const esc = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, c => `\\${c.codePointAt(0)!.toString(16)} `);
function selectorFor(el: Element): string {
  if (el.id) return `#${esc(el.id)}`;
  const parts:string[]=[]; let node:Element|null=el;
  while(node && node!==document.body && parts.length<5){let part=node.tagName.toLowerCase();const stable=[...node.classList].filter(c=>!/active|hover|focus|selected/.test(c)).slice(0,1);if(stable.length)part+='.'+esc(stable[0]!);else if(node.parentElement){const same=[...node.parentElement.children].filter(x=>x.tagName===node!.tagName);if(same.length>1)part+=`:nth-of-type(${same.indexOf(node)+1})`;}parts.unshift(part);node=node.parentElement;}
  return parts.join('>');
}

const KIND: Record<string, string> = {
  A: 'Lien', BUTTON: 'Bouton', IMG: 'Image', INPUT: 'Champ', TEXTAREA: 'Champ',
  SELECT: 'Menu', LABEL: 'Libellé', H1: 'Titre', H2: 'Titre', H3: 'Titre', H4: 'Titre',
  H5: 'Titre', H6: 'Titre', P: 'Paragraphe', LI: 'Élément de liste', UL: 'Liste', OL: 'Liste',
  NAV: 'Navigation', HEADER: 'En-tête', FOOTER: 'Pied de page', SECTION: 'Section',
  ARTICLE: 'Bloc', FORM: 'Formulaire', TABLE: 'Tableau', VIDEO: 'Vidéo', SVG: 'Icône',
};

/**
 * A reviewer is a client, not a front-end developer: `div.hero>button:nth-of-type(2)`
 * tells them nothing. They get "Bouton « Découvrir la collection »" instead, while the
 * selector still travels to the admin. The label is built and shown locally only — it is
 * never sent, so no page text leaks into the ticket beyond what the reviewer types.
 */
function humanLabel(el: Element): string {
  const kind = KIND[el.tagName.toUpperCase()] ?? 'Élément';
  const source =
    el instanceof HTMLInputElement ? el.placeholder || el.getAttribute('aria-label') || el.type :
    el instanceof HTMLImageElement ? el.alt :
    // innerText, not textContent: it honours <br> and hidden nodes, so a two-line
    // heading reads as two words rather than one glued together.
    el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.textContent || '';
  const clean = source.replace(/\s+/g, ' ').trim();
  if (!clean) return kind;
  return `${kind} « ${clean.slice(0, 42)}${clean.length > 42 ? '…' : ''} »`;
}

/**
 * The widget lives on someone else's site, so it dresses like that site — not
 * like the reviewer's operating system. A dark panel dropped onto a white page
 * because macOS is in dark mode is exactly the mismatch that makes an embedded
 * widget look bolted on. The OS preference is only the last resort, for a page
 * that declares no background of its own.
 */
function pageIsDark(): boolean {
  for (const el of [document.body, document.documentElement]) {
    const parsed = el && /rgba?\(([^)]+)\)/.exec(getComputedStyle(el).backgroundColor);
    if (!parsed) continue;
    const [r, g, b, a] = parsed[1]!.split(',').map(Number) as [number, number, number, number?];
    if ((a ?? 1) < 0.5) continue; // see-through: this element is not the ground
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.45;
  }
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

export function init(config: Init) {
  if (!config.api || !config.projectId || !config.token || document.querySelector('reviewdesk-widget')) return;
  const host=document.createElement('reviewdesk-widget'); const root=host.attachShadow({mode:'open'}); document.documentElement.append(host);
  if (config.position === 'bottom-left') host.setAttribute('data-side', 'left');
  const theme = config.theme && config.theme !== 'auto' ? config.theme : (pageIsDark() ? 'dark' : 'light');
  host.setAttribute('data-theme', theme);
  const style=document.createElement('style'); style.textContent=`
/* The theme comes from the page, not from the operating system: see pageIsDark().
   A dark slab dropped on a light client site is the single ugliest thing this
   widget can do, and the OS preference knows nothing about the site it lands on. */
:host{all:initial;
  /* Glass is a stack, not a colour: a translucent tint, a blurred backdrop, a
     specular top edge and a soft cast shadow. Each one is a token so the whole
     material can be retuned in one place. */
  --rd-tint:rgba(255,255,255,.94); --rd-tint-2:rgba(244,244,246,.88); --rd-tint-3:rgba(250,250,252,.92);
  --rd-stroke:rgba(24,24,27,.12); --rd-stroke-2:rgba(24,24,27,.20);
  --rd-spec:inset 0 1px 0 rgba(255,255,255,1),inset 0 0 0 1px rgba(255,255,255,.6);
  --rd-gloss:linear-gradient(158deg,rgba(255,255,255,.7),rgba(255,255,255,.1) 34%,transparent 58%);
  --rd-inset:inset 0 1px 0 rgba(255,255,255,.8);
  --rd-blur:saturate(180%) blur(30px);
  --rd-text:#09090b; --rd-text-2:#52525b; --rd-text-3:#71717a;
  --rd-accent:#09090b; --rd-accent-2:#18181b; --rd-accent-soft:rgba(0,0,0,.06);
  --rd-accent-contrast:#ffffff;
  --rd-pin:#09090b; --rd-danger:#e11d48; --rd-danger-bg:rgba(225,29,72,.09); --rd-ok:#18181b;
  --rd-ring:rgba(0,0,0,.18);
  --rd-lift:0 32px 64px -14px rgba(0,0,0,.22),0 10px 24px -8px rgba(0,0,0,.14),0 1px 2px rgba(0,0,0,.08);
  --rd-lift-2:0 8px 20px -8px rgba(0,0,0,.15),0 1px 2px rgba(0,0,0,.06);
  --rd-spring:cubic-bezier(.32,.72,0,1);
  --rd-edge:22px;
  font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; color:var(--rd-text);
  color-scheme:light;
}
:host([data-theme=dark]){
  /* Opaque enough that the page behind never lightens the text out of contrast:
     the blur is atmosphere, it is not allowed to become the background. */
  --rd-tint:rgba(12,12,15,.92); --rd-tint-2:rgba(24,24,27,.85); --rd-tint-3:rgba(39,39,42,.6);
  --rd-stroke:rgba(255,255,255,.14); --rd-stroke-2:rgba(255,255,255,.24);
  --rd-spec:inset 0 1px 0 rgba(255,255,255,.18),inset 0 0 0 1px rgba(255,255,255,.06);
  --rd-gloss:linear-gradient(158deg,rgba(255,255,255,.16),rgba(255,255,255,.03) 34%,transparent 58%);
  --rd-inset:inset 0 1px 0 rgba(255,255,255,.12);
  --rd-text:#fafafa; --rd-text-2:#d4d4d8; --rd-text-3:#a1a1aa;
  --rd-accent:#ffffff; --rd-accent-2:#f4f4f5; --rd-accent-soft:rgba(255,255,255,.14);
  --rd-accent-contrast:#09090b;
  --rd-pin:#ffffff; --rd-danger:#fb7185; --rd-danger-bg:rgba(251,113,133,.14); --rd-ok:#f4f4f5;
  --rd-ring:rgba(255,255,255,.28);
  --rd-lift:0 32px 64px -14px rgba(0,0,0,.7),0 10px 24px -8px rgba(0,0,0,.45);
  --rd-lift-2:0 8px 20px -8px rgba(0,0,0,.45);
  color-scheme:dark;
}
:host([data-side=left]) .fab,:host([data-side=left]) .panel{right:auto;left:var(--rd-edge)}
:host([data-side=left]) .panel{transform-origin:bottom left}

/* Glass needs something behind it. Where the browser cannot blur, or where the
   viewer asked for less transparency, the same surfaces go opaque rather than
   turning into unreadable milk. */
@supports not (backdrop-filter:blur(1px)){
  :host{--rd-tint:#fcfcfd;--rd-tint-2:#f4f4f6;--rd-tint-3:#f7f7f9}
  :host([data-theme=dark]){--rd-tint:#15151a;--rd-tint-2:#212127;--rd-tint-3:#1c1c21}
}
@media(prefers-reduced-transparency:reduce){
  :host{--rd-tint:#fcfcfd;--rd-tint-2:#f4f4f6;--rd-tint-3:#f7f7f9;--rd-blur:none}
  :host([data-theme=dark]){--rd-tint:#15151a;--rd-tint-2:#212127;--rd-tint-3:#1c1c21}
}

/* ------------------------------------------------------------------ launcher */
.fab{position:fixed;right:var(--rd-edge);bottom:var(--rd-edge);z-index:2147483646;display:inline-flex;align-items:center;gap:9px;
  border:1px solid var(--rd-stroke);border-radius:999px;padding:12px 18px 12px 15px;
  color:var(--rd-accent-contrast);background:var(--rd-accent);
  box-shadow:var(--rd-lift),inset 0 1px 0 rgba(255,255,255,.22);
  font:600 13.5px/1 inherit;letter-spacing:-.01em;cursor:pointer;isolation:isolate;
  transition:transform .32s var(--rd-spring),box-shadow .32s var(--rd-spring),filter .2s ease}
.fab:hover{transform:translateY(-2px) scale(1.015);filter:contrast(1.15) brightness(1.08);
  box-shadow:var(--rd-lift),0 0 0 6px var(--rd-accent-soft)}
.fab:active{transform:translateY(0) scale(.975);transition-duration:.1s}
.fab:has(+.panel:not(.hidden)),.fab.away{display:none}
.fab svg{width:16px;height:16px;flex:none}
.fab .fab-kbd{font:700 10.5px/1 ui-monospace,SFMono-Regular,Menlo,monospace;
  padding:2px 5px;border-radius:5px;background:rgba(128,128,128,.2);
  border:1px solid currentColor;opacity:.82;letter-spacing:0}
.fab .badge{min-width:19px;height:19px;border-radius:999px;background:var(--rd-accent-contrast);color:var(--rd-accent);
  font:700 11px/19px inherit;text-align:center;padding:0 5px;box-sizing:border-box;
  box-shadow:0 1px 3px rgba(0,0,0,.25)}
.fab .badge.hidden{display:none}

/* --------------------------------------------------------------------- panel */
.panel{position:fixed;right:var(--rd-edge);bottom:var(--rd-edge);z-index:2147483647;width:min(392px,calc(100vw - 24px));
  max-height:calc(100dvh - 44px);display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box;
  background:var(--rd-tint);-webkit-backdrop-filter:var(--rd-blur);backdrop-filter:var(--rd-blur);
  border:1px solid var(--rd-stroke);border-radius:24px;
  box-shadow:var(--rd-lift),var(--rd-spec);
  transform-origin:bottom right;animation:rd-in .34s var(--rd-spring)}
/* The rim light rides the top and left edges only, the way a real bevel catches
   a room's light — an even border on four sides reads as a box, not as glass. */
.panel::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:0;
  background:var(--rd-gloss)}
@keyframes rd-in{from{opacity:0;transform:translateY(14px) scale(.94)}}
.hidden{display:none!important}
.head,.tabs,.body{position:relative;z-index:1}
.body{overflow:auto;padding:0 18px 18px;overscroll-behavior:contain}

.head{display:flex;align-items:center;gap:11px;padding:16px 14px 12px 18px}
.head .mark{width:30px;height:30px;border-radius:10px;flex:none;display:grid;place-items:center;
  color:var(--rd-accent-contrast);background:var(--rd-accent);border:1px solid var(--rd-stroke);
  box-shadow:var(--rd-lift-2),inset 0 1px 0 rgba(255,255,255,.2)}
.head .mark svg{width:16px;height:16px}
.title{font-weight:640;font-size:15px;letter-spacing:-.014em;line-height:1.2}
.sub{font-size:11.5px;color:var(--rd-text-3);line-height:1.3;margin-top:1px}
.head .grow{flex:1;min-width:0}
.close{flex:none;border:1px solid var(--rd-stroke);background:var(--rd-tint-3);color:var(--rd-text-2);
  width:30px;height:30px;border-radius:10px;font:400 16px/1 inherit;display:grid;place-items:center;
  transition:background .2s var(--rd-spring),color .2s,border-color .2s}
.close:hover{background:var(--rd-tint-2);border-color:var(--rd-stroke-2);color:var(--rd-text)}

/* A segmented control moves; it does not repaint. The pill slides so the eye
   follows the selection instead of re-finding it. */
.tabs{position:relative;display:flex;gap:2px;padding:3px;margin:0 18px 15px;border-radius:13px;
  background:var(--rd-tint-3);border:1px solid var(--rd-stroke)}
.tabs .ind{position:absolute;top:3px;left:3px;width:calc(50% - 3px);height:calc(100% - 6px);border-radius:10px;
  background:var(--rd-tint-2);border:1px solid var(--rd-stroke);
  box-shadow:var(--rd-lift-2),var(--rd-inset);
  transition:transform .38s var(--rd-spring)}
.tabs.on-mine .ind{transform:translateX(100%)}
.tab{position:relative;z-index:1;flex:1;border:0;background:transparent;color:var(--rd-text-2);padding:8px;
  border-radius:10px;font:600 12.5px inherit;display:inline-flex;align-items:center;justify-content:center;gap:6px;
  transition:color .24s var(--rd-spring)}
.tab[aria-pressed=true]{color:var(--rd-text)}
.tab .badge{min-width:17px;height:17px;border-radius:999px;color:var(--rd-accent-contrast);
  background:var(--rd-accent);font:700 10.5px/17px inherit;text-align:center;padding:0 4px;box-sizing:border-box}
.tab .badge.hidden{display:none}

/* --------------------------------------------------------------------- steps */
.steps{list-style:none;margin:0;padding:0;display:grid;gap:15px}
.step{display:grid;grid-template-columns:23px minmax(0,1fr);gap:11px;align-items:start}
.num{width:23px;height:23px;border-radius:999px;background:var(--rd-tint-2);border:1px solid var(--rd-stroke-2);
  color:var(--rd-text-2);font:700 11px/21px inherit;text-align:center;margin-top:1px;box-sizing:border-box;
  transition:background .3s var(--rd-spring),color .3s,box-shadow .3s var(--rd-spring)}
.step.done .num{background:var(--rd-accent);color:var(--rd-accent-contrast);border-color:transparent;
  box-shadow:0 4px 10px -2px var(--rd-ring),inset 0 1px 0 rgba(255,255,255,.3)}
.step-label{font:600 12.5px inherit;letter-spacing:-.008em;margin-bottom:7px;display:block}
.step-label .opt{font-weight:500;color:var(--rd-text-3)}

.target{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;text-align:left;
  border:1.5px dashed var(--rd-stroke-2);background:var(--rd-tint-3);color:var(--rd-text-2);
  border-radius:13px;padding:12px 13px;font:500 13px inherit;cursor:pointer;
  transition:border-color .24s var(--rd-spring),background .24s,color .24s,box-shadow .24s var(--rd-spring),transform .24s var(--rd-spring)}
.target:hover{border-color:var(--rd-accent);color:var(--rd-text);background:var(--rd-accent-soft);
  box-shadow:0 0 0 4px var(--rd-accent-soft)}
.target:active{transform:scale(.99)}
.target svg{width:17px;height:17px;flex:none;color:var(--rd-text-2)}
.target .lbl{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.target .act{flex:none;font:600 11.5px inherit;color:var(--rd-text)}
.target.set{border-style:solid;border-color:var(--rd-stroke);background:var(--rd-tint-2);color:var(--rd-text);
  font-weight:600;box-shadow:var(--rd-lift-2),var(--rd-inset)}
.target.set svg{color:var(--rd-accent)}
.target-row{display:flex;gap:8px;align-items:center}
.target-row .target{flex:1;min-width:0}
.target-locate{flex:none;width:42px;height:42px;display:grid;place-items:center;border:1.5px solid var(--rd-stroke-2);
  border-radius:13px;background:var(--rd-tint-3);color:var(--rd-text);cursor:pointer;
  transition:border-color .24s var(--rd-spring),background .24s,transform .24s var(--rd-spring)}
.target-locate:hover{background:var(--rd-accent-soft);border-color:var(--rd-accent);transform:scale(1.04)}
.target-locate svg{width:18px;height:18px}
.target-cancel{flex:none;height:42px;padding:0 12px;display:inline-flex;align-items:center;gap:4px;
  border:1.5px solid var(--rd-stroke-2);border-radius:13px;background:var(--rd-tint-3);
  color:var(--rd-text-2);font:600 12px inherit;cursor:pointer;
  transition:border-color .2s,color .2s,background .2s,transform .2s var(--rd-spring)}
.target-cancel:hover{border-color:var(--rd-danger);color:var(--rd-danger);background:var(--rd-danger-bg);transform:scale(1.02)}

.category-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.category-chips .chip{border:1px solid var(--rd-stroke-2);background:var(--rd-tint-3);color:var(--rd-text-2);
  padding:6px 10px;border-radius:9px;font:500 12px inherit;cursor:pointer;display:inline-flex;align-items:center;gap:6px;
  transition:all .18s var(--rd-spring)}
.category-chips .chip kbd{font:700 9.5px/1 ui-monospace,SFMono-Regular,Menlo,monospace;
  padding:1px 4px;border-radius:4px;border:1px solid var(--rd-stroke-2);background:var(--rd-tint-2);color:var(--rd-text-3)}
.category-chips .chip:hover{color:var(--rd-text);background:var(--rd-tint-2);border-color:var(--rd-stroke)}
.category-chips .chip.selected{background:var(--rd-accent);color:var(--rd-accent-contrast);border-color:var(--rd-accent);font-weight:600}
.category-chips .chip.selected kbd{background:rgba(128,128,128,.3);color:inherit;border-color:currentColor}
.composer-tip{display:flex;align-items:center;gap:8px;background:var(--rd-tint-2);border:1px solid var(--rd-stroke);
  border-radius:11px;padding:8px 11px;font-size:11.5px;color:var(--rd-text-2);line-height:1.45;margin-bottom:14px}

textarea{all:unset;display:block;box-sizing:border-box;width:100%;min-height:100px;border:1px solid var(--rd-stroke-2);
  border-radius:13px;padding:12px 13px;background:var(--rd-tint-2);color:var(--rd-text);
  font:13.5px/1.55 inherit;white-space:pre-wrap;
  transition:border-color .2s,box-shadow .2s,background .2s}
textarea:focus{border-color:var(--rd-accent);box-shadow:0 0 0 4px var(--rd-ring)}
textarea::placeholder{color:var(--rd-text-3);opacity:1}

/* -------------------------------------------------------------------- extras */
.extras{margin-top:16px;border-top:1px solid var(--rd-stroke);padding-top:14px;display:grid;gap:10px}
.attach{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--rd-stroke-2);background:var(--rd-tint-2);
  color:var(--rd-text-2);border-radius:11px;padding:9px 13px;font:600 12.5px inherit;cursor:pointer;justify-self:start;
  box-shadow:var(--rd-inset);transition:color .22s,transform .22s var(--rd-spring),box-shadow .22s}
.attach:hover{color:var(--rd-text);box-shadow:var(--rd-lift-2),var(--rd-inset);transform:translateY(-1px)}
.attach svg{width:15px;height:15px}
.attach-hint{font-size:11.5px;color:var(--rd-text-3);margin-top:-4px;line-height:1.45}
input[type=file]{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
.shot{display:flex;align-items:center;gap:11px;border:1px solid var(--rd-stroke);background:var(--rd-tint-2);
  border-radius:12px;padding:9px 11px;box-shadow:var(--rd-inset)}
.shot img{width:40px;height:40px;object-fit:cover;border-radius:9px;flex:none;background:var(--rd-tint-3);
  box-shadow:0 2px 6px rgba(18,18,27,.18)}
.shot .name{flex:1;min-width:0;font-size:12px;color:var(--rd-text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.shot .drop{flex:none;border:0;background:transparent;color:var(--rd-text-3);font:600 12px inherit;padding:5px 8px;border-radius:8px}
.shot .drop:hover{color:var(--rd-danger);background:var(--rd-tint-3)}

.privacy{display:flex;align-items:flex-start;gap:10px;font-size:12.5px;color:var(--rd-text-2);line-height:1.45;cursor:pointer}
.privacy input[type=checkbox]{margin:1px 0 0;accent-color:var(--rd-accent);width:15px;height:15px;flex:none}
.privacy .why{display:block;font-size:11.5px;color:var(--rd-text-3);margin-top:2px}
.seediag{border:0;background:transparent;color:var(--rd-text);font:600 11.5px inherit;padding:0;justify-self:start;
  text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px}
.diag{background:var(--rd-tint-3);border:1px solid var(--rd-stroke);color:var(--rd-text-2);padding:10px 11px;
  border-radius:11px;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;
  max-height:132px;overflow:auto;margin:0}

/* ------------------------------------------------------------------- actions */
button{font:600 13px inherit;cursor:pointer;border-radius:11px;
  transition:background .22s var(--rd-spring),border-color .22s,color .22s,transform .22s var(--rd-spring),box-shadow .22s var(--rd-spring)}
.actions{display:flex;gap:9px;align-items:center;margin-top:16px;padding-top:15px;border-top:1px solid var(--rd-stroke)}
.primary{position:relative;border:1px solid var(--rd-stroke);color:var(--rd-accent-contrast);padding:11px 18px;margin-left:auto;isolation:isolate;
  background:var(--rd-accent);box-shadow:var(--rd-lift-2),inset 0 1px 0 rgba(255,255,255,.25);
  transition:filter .2s,transform .2s var(--rd-spring),box-shadow .2s}
.primary::before{display:none}
.primary:hover{filter:contrast(1.15) brightness(1.08);transform:translateY(-1px);
  box-shadow:var(--rd-lift-2),0 0 0 5px var(--rd-accent-soft)}
.primary:active{transform:translateY(0) scale(.985);transition-duration:.1s}
.primary:disabled{opacity:.5;cursor:not-allowed;transform:none;filter:none}
.secondary{border:1px solid var(--rd-stroke-2);background:var(--rd-tint-2);color:var(--rd-text-2);padding:11px 14px;
  box-shadow:var(--rd-inset)}
.secondary:hover{color:var(--rd-text);box-shadow:var(--rd-lift-2),var(--rd-inset)}
.kbd{font-size:11px;color:var(--rd-text-3);margin-right:auto}
:host *:focus-visible{outline:2px solid var(--rd-accent);outline-offset:2px}

.shortcuts-bar{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:14px;padding:8px 10px;
  background:var(--rd-tint-3);border:1px solid var(--rd-stroke);border-radius:10px;font-size:11px;color:var(--rd-text-3)}
.sc-item{display:inline-flex;align-items:center;gap:4px}
.sc-item kbd{background:var(--rd-tint-2);border:1px solid var(--rd-stroke-2);border-radius:4px;padding:1px 4px;
  font:700 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--rd-text-2);box-shadow:0 1px 1px rgba(0,0,0,.06)}

.msg{margin-top:13px;border-radius:11px;padding:10px 12px;font-size:12.5px;line-height:1.45;
  color:var(--rd-danger);background:var(--rd-danger-bg);border:1px solid currentColor;
  animation:rd-in .28s var(--rd-spring)}

/* --------------------------------------------------------------------- sent */
.sent{text-align:center;padding:26px 6px 6px}
.sent .check{width:56px;height:56px;border-radius:999px;color:var(--rd-accent-contrast);display:grid;place-items:center;margin:0 auto 16px;
  background:var(--rd-accent);border:1px solid var(--rd-stroke);
  box-shadow:var(--rd-lift),0 0 0 8px var(--rd-accent-soft),inset 0 1px 0 rgba(255,255,255,.3);
  animation:rd-pop .5s var(--rd-spring)}
.sent .check svg{width:26px;height:26px}
@keyframes rd-pop{from{transform:scale(.5);opacity:0}}
.sent h2{margin:0 0 6px;font:640 16px inherit;letter-spacing:-.014em}
.sent p{margin:0;font-size:12.5px;color:var(--rd-text-2);line-height:1.55}
.sent .actions{border-top:0;justify-content:center;margin-top:20px;padding-top:0}
.sent .primary{margin-left:0}

/* ----------------------------------------------------------------- my replies */
.mine{display:grid;gap:10px;max-height:340px;overflow:auto}
.mine .item{border:1px solid var(--rd-stroke);border-radius:14px;padding:12px 13px;background:var(--rd-tint-2);
  box-shadow:var(--rd-lift-2),var(--rd-inset)}
.mine .item p{margin:0;font-size:12.5px;line-height:1.5;overflow-wrap:anywhere}
.mine .item .st{display:inline-flex;align-items:center;gap:6px;font:600 10.5px inherit;letter-spacing:.05em;
  text-transform:uppercase;color:var(--rd-text-3);margin-bottom:6px}
.mine .item .st::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor;
  box-shadow:0 0 0 3px color-mix(in srgb,currentColor 18%,transparent)}
.mine .item.DONE .st{color:var(--rd-text);font-weight:700}
.mine .item.REVIEW .st{color:var(--rd-text-2);font-weight:700}
.mine .item.IN_PROGRESS .st{color:var(--rd-text-2)}
.mine .item.TODO .st{color:var(--rd-text-3)}
.mine .item .item-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}
.mine .item .locate-ticket{border:0;background:var(--rd-tint-3);color:var(--rd-text);font:600 11px inherit;
  padding:3px 8px;border-radius:6px;display:inline-flex;align-items:center;gap:4px;cursor:pointer;
  border:1px solid var(--rd-stroke);transition:all .18s ease}
.mine .item .locate-ticket:hover{background:var(--rd-accent-soft);border-color:var(--rd-accent)}
.mine .item .locate-ticket svg{width:13px;height:13px}
.review-actions{display:flex;gap:7px;margin-top:10px;padding-top:8px;border-top:1px dashed var(--rd-stroke)}
.btn-validate{flex:1;border:1px solid var(--rd-stroke);color:var(--rd-accent-contrast);background:var(--rd-accent);
  padding:7px 10px;border-radius:9px;font:600 12px inherit;cursor:pointer;
  box-shadow:var(--rd-lift-2);transition:all .2s ease}
.btn-validate:hover{filter:contrast(1.15) brightness(1.08);transform:translateY(-1px)}
.btn-reopen{flex:1;border:1px solid var(--rd-stroke-2);background:var(--rd-tint-3);color:var(--rd-text-2);
  padding:7px 10px;border-radius:9px;font:600 12px inherit;cursor:pointer;transition:all .2s ease}
.btn-reopen:hover{color:var(--rd-text);background:var(--rd-tint-2);border-color:var(--rd-stroke)}
.reopen-box{margin-top:9px;display:grid;gap:7px}
.reopen-input{all:unset;display:block;box-sizing:border-box;width:100%;min-height:56px;border:1px solid var(--rd-stroke-2);
  border-radius:9px;padding:8px 10px;background:var(--rd-tint-3);color:var(--rd-text);font:12px/1.4 inherit}
.reopen-input:focus{border-color:var(--rd-accent);box-shadow:0 0 0 3px var(--rd-ring)}
.reopen-actions{display:flex;justify-content:flex-end;gap:6px}
.reopen-cancel{border:1px solid var(--rd-stroke-2);background:transparent;color:var(--rd-text-3);
  padding:5px 9px;border-radius:7px;font:500 11.5px inherit;cursor:pointer}
.reopen-cancel:hover{color:var(--rd-text);background:var(--rd-tint-3)}
.reopen-submit{border:1px solid var(--rd-stroke);background:var(--rd-accent);color:var(--rd-accent-contrast);padding:5px 11px;border-radius:7px;
  font:600 11.5px inherit;cursor:pointer}
.reopen-submit:hover{filter:contrast(1.15) brightness(1.08)}
.action-notice{margin-top:8px;padding:6px 9px;border-radius:8px;font-size:11.5px;font-weight:500;
  display:flex;align-items:center;gap:6px}
.action-notice.done{background:var(--rd-tint-2);color:var(--rd-text);border:1px solid var(--rd-stroke)}
.action-notice.reopened{background:var(--rd-tint-2);color:var(--rd-text-2);border:1px solid var(--rd-stroke)}
.halo-flash{position:fixed;z-index:2147483643;pointer-events:none;border-radius:9px;
  border:2px solid var(--rd-accent);box-shadow:0 0 0 4px var(--rd-accent-soft),0 0 20px rgba(0,0,0,.25);
  animation:rd-halo 1.5s cubic-bezier(.32,.72,0,1) forwards}
@keyframes rd-halo{0%{opacity:0;transform:scale(.96)}20%{opacity:1;transform:scale(1.02)}45%{transform:scale(1)}80%{opacity:1}100%{opacity:0}}
.mine .item .reply{margin-top:10px;padding:10px 11px;border-radius:10px;background:var(--rd-tint-3);
  border:1px solid var(--rd-stroke);font-size:12px;color:var(--rd-text-2);line-height:1.5}
.mine .item .reply strong{display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;
  color:var(--rd-text);margin-bottom:4px}
.mine .empty{color:var(--rd-text-3);font-size:12.5px;text-align:center;padding:28px 14px;line-height:1.55}

/* ---------------------------------------------------------------------- pins */
.pin{position:fixed;z-index:2147483645;width:28px;height:28px;border-radius:50%;
  background:var(--rd-accent);color:var(--rd-accent-contrast);display:grid;place-items:center;
  transform:translate(-50%,-50%);font:800 12px/1 inherit;pointer-events:auto;cursor:pointer;
  border:2.5px solid var(--rd-accent-contrast);
  box-shadow:0 6px 18px rgba(0,0,0,.4),0 1px 3px rgba(0,0,0,.3),0 0 0 1px var(--rd-stroke);
  transition:transform .2s var(--rd-spring),box-shadow .2s,background .2s,color .2s}
.pin:hover{transform:translate(-50%,-50%) scale(1.15);box-shadow:0 8px 24px rgba(0,0,0,.5),0 0 0 1px var(--rd-stroke)}
.pin:hover::after{content:"✕";position:absolute;inset:0;display:grid;place-items:center;
  background:var(--rd-accent);color:var(--rd-accent-contrast);border-radius:50%;font-size:12px;font-weight:700}
.pin::before{content:"";position:absolute;inset:-7px;border-radius:50%;
  border:2px solid var(--rd-accent);opacity:.4;animation:rd-ping 2.4s var(--rd-spring) infinite}
@keyframes rd-ping{0%{transform:scale(.8);opacity:.45}70%,100%{transform:scale(1.4);opacity:0}}
/* The pin replayed from an admin deep link is deliberately styled differently */
.pin.replay{pointer-events:none;background:var(--rd-accent-contrast);color:var(--rd-accent);
  border:2.5px solid var(--rd-accent);box-shadow:0 6px 18px var(--rd-ring),0 1px 3px rgba(0,0,0,.3)}
.pin.replay::after{display:none}
.pin.replay::before{border-color:var(--rd-accent)}
.pin.missing{background:var(--rd-accent-contrast);color:var(--rd-danger);border-color:var(--rd-danger);
  box-shadow:0 6px 18px rgba(225,29,72,.3)}
.pin.missing::before{display:none}

/* -------------------------------------------------------------- pick overlay */
.pick{position:fixed;inset:0;z-index:2147483644;cursor:crosshair;background:rgba(0,0,0,.08)}
/* The highlight is a lens, not a box */
.hl{position:fixed;z-index:2147483643;pointer-events:none;border-radius:9px;
  border:2px solid #ffffff;
  box-shadow:0 0 0 9999px rgba(0,0,0,.38),0 0 0 1.5px #09090b,
    0 14px 34px -10px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.4);
  transition:all .13s var(--rd-spring)}
.hl.hidden{display:none}
/* pointer-events:none so the bar never shields whatever sits under it */
.pickbar{position:fixed;left:50%;top:22px;transform:translateX(-50%);display:flex;align-items:center;gap:12px;
  max-width:min(560px,calc(100vw - 32px));color:#fff;font:600 12.5px/1.3 inherit;
  padding:9px 9px 9px 17px;border-radius:999px;pointer-events:none;
  background:rgba(9,9,11,.88);-webkit-backdrop-filter:var(--rd-blur);backdrop-filter:var(--rd-blur);
  border:1px solid rgba(255,255,255,.18);
  box-shadow:0 20px 40px -12px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.2);
  animation:rd-bar .34s var(--rd-spring)}
@keyframes rd-bar{from{opacity:0;transform:translate(-50%,-12px) scale(.96)}}
.pickbar>span:first-child{flex:none;white-space:nowrap}
.pickbar .what{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.72;font-weight:500}
.pickbar .what:empty{display:none}
.pickcancel{pointer-events:auto;cursor:pointer;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.14);
  color:inherit;padding:7px 13px;border-radius:999px;font:600 12px inherit;flex:none;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.2);transition:background .2s}
.pickcancel:hover{background:rgba(255,255,255,.26)}

@media(max-width:520px){
  :host{--rd-edge:12px}
  .panel{right:12px;left:12px;bottom:12px;width:auto;max-height:calc(100dvh - 24px);border-radius:22px;
    transform-origin:bottom center}
  .fab{padding:12px 16px 12px 14px}
  textarea{min-height:90px}
  .primary,.secondary{min-height:46px}
  .primary{flex:1}
  .kbd{display:none}
  .shortcuts-bar{display:none}
  .pickbar{left:12px;right:12px;transform:none;max-width:none}
  @keyframes rd-bar{from{opacity:0;transform:translateY(-12px)}}
}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition-duration:.01ms!important}}
`;
  if (config.accent) {
    host.style.setProperty('--rd-accent', config.accent);
    host.style.setProperty('--rd-accent-hover', config.accent);
  }
  // The product's mark, so the button the client sees is the same brand as the
  // admin: a speech bubble whose one visible content is the point talked about.
  const PIN_SVG=`<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M7.6 4h8.8a4 4 0 0 1 4 4v4.9a4 4 0 0 1-4 4h-3.8l-3.9 3.5a.7.7 0 0 1-1.2-.5v-3H7.6a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4Zm4.4 3.9a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2Z"/></svg>`;
  const TARGET_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="7.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>`;
  const IMAGE_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m4 17 5-4.5 4.5 4 3-2.5L20 18"/></svg>`;
  const CHECK_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`;

  root.append(style);
  const launcherLabel = config.label?.trim() || 'Faire un retour';
  const fab=document.createElement('button');fab.className='fab';fab.type='button';
  fab.innerHTML=`${PIN_SVG}<span class="fab-label"></span><kbd class="fab-kbd" title="Raccourci [C]">C</kbd><span class="badge hidden"></span>`;
  (fab.querySelector('.fab-label') as HTMLElement).textContent=launcherLabel;
  fab.setAttribute('aria-label', `${launcherLabel} (Donner mon avis)`);
  root.append(fab);

  const panel=document.createElement('section');panel.className='panel hidden';
  panel.setAttribute('aria-label','Retours sur cette page');
  panel.innerHTML=`
<header class="head">
  <span class="mark">${PIN_SVG}</span>
  <div class="grow"><div class="title">Vos retours</div><div class="sub">Sur cette page, en deux étapes.</div></div>
  <button type="button" class="close" aria-label="Fermer">✕</button>
</header>
<div class="tabs">
  <span class="ind"></span>
  <button type="button" class="tab tab-compose" aria-pressed="true">Nouveau retour</button>
  <button type="button" class="tab tab-mine" aria-pressed="false">Mes retours<span class="badge hidden"></span></button>
</div>
<div class="body">
  <div class="view-compose">
    <div class="composer-tip">
      <span>💡 Pointez un élément pour situer votre retour, ou écrivez directement ci-dessous.</span>
    </div>
    <ol class="steps">
      <li class="step step-target">
        <span class="num">1</span>
        <div>
          <span class="step-label">Montrez l’endroit concerné</span>
          <div class="target-row">
            <button type="button" class="target">${TARGET_SVG}<span class="lbl">Cliquez ici, puis l’endroit sur la page</span><span class="act"></span></button>
            <button type="button" class="target-locate hidden" title="Voir l’élément sur la page" aria-label="Voir l’élément sur la page">${TARGET_SVG}</button>
            <button type="button" class="target-cancel hidden" title="Retirer l’épingle (Échap)" aria-label="Retirer l’épingle">✕ Retirer</button>
          </div>
        </div>
      </li>
      <li class="step step-text">
        <span class="num">2</span>
        <div>
          <span class="step-label">Dites ce qui ne va pas</span>
          <div class="category-chips">
            <button type="button" class="chip" data-prefix="[Bug] ">🐛 Bug <kbd>1</kbd></button>
            <button type="button" class="chip" data-prefix="[Visuel] ">🎨 Visuel <kbd>2</kbd></button>
            <button type="button" class="chip" data-prefix="[Contenu] ">✍️ Contenu <kbd>3</kbd></button>
            <button type="button" class="chip" data-prefix="[Idée] ">💡 Idée <kbd>4</kbd></button>
          </div>
          <textarea maxlength="4000" placeholder="Ex. : ce bouton est trop discret sur mobile, on ne le voit pas."></textarea>
        </div>
      </li>
    </ol>
    <div class="extras">
      <label class="attach">${IMAGE_SVG}<span class="attach-label">Ajouter une capture</span><input class="file-input" type="file" accept="image/png,image/jpeg,image/webp"></label>
      <div class="attach-hint">Facultatif — PNG, JPEG ou WebP, 4 Mo max. Vous pouvez aussi coller une image.</div>
      <div class="shot hidden"><img alt=""><span class="name"></span><button type="button" class="drop">Retirer</button></div>
      <label class="privacy"><input type="checkbox" class="diagcheck"><span>Joindre mes infos techniques<span class="why">Taille d’écran, navigateur, page. Aucune donnée personnelle, aucune saisie.</span></span></label>
      <button type="button" class="seediag hidden">Voir ce qui sera envoyé</button>
      <pre class="diag hidden"></pre>
    </div>
    <div class="msg hidden" role="alert"></div>
    <div class="actions">
      <span class="kbd">⌘ + ↵ pour envoyer</span>
      <button type="button" class="primary send">Envoyer mon retour</button>
    </div>
    <div class="shortcuts-bar">
      <span class="sc-item"><kbd>P</kbd> Pointer</span>
      <span class="sc-item"><kbd>1-4</kbd> Tags</span>
      <span class="sc-item"><kbd>Échap</kbd> Annuler</span>
      <span class="sc-item"><kbd>⌘↵</kbd> Envoyer</span>
    </div>
  </div>
  <div class="view-sent hidden">
    <div class="sent">
      <div class="check">${CHECK_SVG}</div>
      <h2>Retour envoyé, merci&nbsp;!</h2>
      <p>Vous serez prévenu ici même dès qu’une réponse arrive : rouvrez ce bouton et allez dans « Mes retours ».</p>
      <div class="actions">
        <button type="button" class="secondary again">Écrire un autre retour</button>
        <button type="button" class="primary goto-mine">Voir mes retours</button>
      </div>
    </div>
  </div>
  <div class="view-mine hidden"><div class="mine"></div></div>
</div>`;
  root.append(panel);

  let anchor:any=null,pin:HTMLElement|null=null;
  const targetBtn=panel.querySelector('.target') as HTMLButtonElement;
  const targetLocate=panel.querySelector('.target-locate') as HTMLButtonElement;
  const targetCancel=panel.querySelector('.target-cancel') as HTMLButtonElement;
  const targetLabel=panel.querySelector('.target .lbl') as HTMLElement;
  const targetAct=panel.querySelector('.target .act') as HTMLElement;
  const stepTarget=panel.querySelector('.step-target') as HTMLElement;
  const textarea=panel.querySelector('textarea') as HTMLTextAreaElement;
  const chips=panel.querySelectorAll<HTMLButtonElement>('.category-chips .chip');
  const check=panel.querySelector('.diagcheck') as HTMLInputElement;
  const seediag=panel.querySelector('.seediag') as HTMLButtonElement;
  const diag=panel.querySelector('.diag') as HTMLElement;
  const file=panel.querySelector('.file-input') as HTMLInputElement;
  const shot=panel.querySelector('.shot') as HTMLElement;
  const shotImg=panel.querySelector('.shot img') as HTMLImageElement;
  const shotName=panel.querySelector('.shot .name') as HTMLElement;
  const msg=panel.querySelector('.msg') as HTMLElement;
  const sendBtn=panel.querySelector('.send') as HTMLButtonElement;

  function flashElement(selector: string){
    try{
      const el=document.querySelector(selector);
      if(!el)return;
      el.scrollIntoView({behavior:'smooth',block:'center'});
      const halo=document.createElement('div');
      halo.className='halo-flash';
      root.append(halo);
      const updateHalo=()=>{
        const r=el.getBoundingClientRect();
        halo.style.left=r.left+'px';
        halo.style.top=r.top+'px';
        halo.style.width=r.width+'px';
        halo.style.height=r.height+'px';
      };
      updateHalo();
      const interval=setInterval(updateHalo,50);
      setTimeout(()=>{clearInterval(interval);halo.remove();},1500);
    }catch{/* element unlocatable or invalid selector */}
  }

  targetLocate.addEventListener('click',()=>{
    if(anchor?.selector)flashElement(anchor.selector);
  });

  const PREFIXES=['[Bug] ','[Visuel] ','[Contenu] ','[Idée] '];
  chips.forEach(chip=>{
    chip.addEventListener('click',()=>{
      const prefix=chip.dataset.prefix!;
      const isSelected=chip.classList.contains('selected');
      chips.forEach(c=>c.classList.remove('selected'));
      let val=textarea.value;
      for(const p of PREFIXES){
        if(val.startsWith(p)){val=val.slice(p.length);break;}
      }
      if(!isSelected){
        chip.classList.add('selected');
        val=prefix+val;
      }
      textarea.value=val;
      (panel.querySelector('.step-text') as HTMLElement).classList.toggle('done',textarea.value.trim().length>1);
      textarea.focus();
    });
  });
  const syncChipsFromText=()=>{
    const val=textarea.value;
    chips.forEach(chip=>{
      chip.classList.toggle('selected',val.startsWith(chip.dataset.prefix!));
    });
  };

  const diagnostics=()=>normalizeDiagnostics({viewport:{width:innerWidth,height:innerHeight},dpr:devicePixelRatio,orientation:innerWidth>=innerHeight?'landscape':'portrait',locale:navigator.language,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,userAgent:navigator.userAgent,platform:navigator.platform,path:location.href,errors:anchor?[]:[{category:'widget',code:'ANCHOR_MISSING',count:1}]});

  /** Consent stays explicit, and the payload stays one click away from being read. */
  const refreshDiag=()=>{diag.textContent=check.checked?JSON.stringify(diagnostics(),null,2):'';};
  check.addEventListener('change',()=>{
    seediag.classList.toggle('hidden',!check.checked);
    diag.classList.add('hidden');
    seediag.textContent='Voir ce qui sera envoyé';
    refreshDiag();
  });
  seediag.addEventListener('click',()=>{
    const shown=diag.classList.toggle('hidden');
    seediag.textContent=shown?'Voir ce qui sera envoyé':'Masquer les données';
    if(!shown)refreshDiag();
  });

  const showError=(text:string)=>{msg.textContent=text;msg.classList.remove('hidden');};
  const clearError=()=>{msg.textContent='';msg.classList.add('hidden');};

  /** Keeps step 1 honest about whether a point is already set. */
  function syncAnchorUi(){
    const set=Boolean(anchor);
    targetBtn.classList.toggle('set',set);
    targetLocate.classList.toggle('hidden',!set);
    targetCancel.classList.toggle('hidden',!set);
    stepTarget.classList.toggle('done',set);
    targetLabel.textContent=set?anchor.label:'Cliquez ici, puis l’endroit sur la page';
    targetBtn.title=set?`${anchor.selector} — Cliquer pour changer`:'';
    targetAct.textContent=set?'Changer':'';
  }

  function cancelAnchor(){
    if(!anchor && !pin) return;
    pin?.remove();
    pin=null;
    anchor=null;
    syncAnchorUi();
    clearError();
    if(check.checked)refreshDiag();
  }
  targetCancel.addEventListener('click',cancelAnchor);

  // ------------------------------------------------------- optional screenshot

  let shotUrl:string|null=null;
  function setShot(picked:File|null){
    if(shotUrl){URL.revokeObjectURL(shotUrl);shotUrl=null;}
    if(!picked){file.value='';shot.classList.add('hidden');shotImg.removeAttribute('src');return;}
    if(!['image/png','image/jpeg','image/webp'].includes(picked.type)){file.value='';showError('Format non accepté : utilisez PNG, JPEG ou WebP.');return;}
    if(picked.size>UPLOAD_MAX_BYTES){file.value='';showError('Capture trop lourde : 4 Mo maximum.');return;}
    clearError();
    shotUrl=URL.createObjectURL(picked);
    shotImg.src=shotUrl;shotName.textContent=picked.name;shot.classList.remove('hidden');
  }
  file.addEventListener('change',()=>setShot(file.files?.[0]??null));
  panel.querySelector('.shot .drop')!.addEventListener('click',()=>setShot(null));
  // Pasting is how anyone actually moves a screenshot around; a file picker is
  // three extra steps for the same PNG.
  panel.addEventListener('paste',(event)=>{
    const pasted=[...((event as ClipboardEvent).clipboardData?.files ?? [])][0];
    if(!pasted)return;
    event.preventDefault();
    const transfer=new DataTransfer();transfer.items.add(pasted);file.files=transfer.files;
    setShot(pasted);
  });

  // ------------------------------------------------------------------ picking

  /**
   * Picking is always escapable. Trapping the reviewer until they click some
   * element is what forced anyone who only wanted to read replies to file a
   * throwaway comment first.
   */
  function pick(){
    panel.classList.add('hidden');fab.classList.add('away');
    const overlay=document.createElement('div');overlay.className='pick';
    overlay.innerHTML=`<div class="pickbar"><span>Cliquez l’endroit concerné</span><span class="what"></span><button type="button" class="pickcancel">Annuler</button></div>`;
    const highlight=document.createElement('div');highlight.className='hl hidden';
    root.append(highlight,overlay);
    const what=overlay.querySelector('.what') as HTMLElement;
    const stop=()=>{overlay.remove();highlight.remove();removeEventListener('keydown',onKey,true);fab.classList.remove('away');panel.classList.remove('hidden');};
    const onKey=(ev:KeyboardEvent)=>{if(ev.key==='Escape'){ev.preventDefault();stop();}};
    addEventListener('keydown',onKey,true);
    const under=(x:number,y:number)=>{const el=document.elementFromPoint(x,y);return !el||el===host?null:el;};
    // While the overlay is still up it is itself the topmost hit target, so it
    // steps aside for the duration of the lookup.
    const beneath=(x:number,y:number)=>{
      overlay.style.pointerEvents='none';
      try{return under(x,y);}finally{overlay.style.pointerEvents='';}
    };
    overlay.addEventListener('pointermove',(ev:PointerEvent)=>{
      const el=beneath(ev.clientX,ev.clientY);
      if(!el){highlight.classList.add('hidden');what.textContent='';return;}
      const r=el.getBoundingClientRect();
      highlight.classList.remove('hidden');
      highlight.style.left=r.left+'px';highlight.style.top=r.top+'px';
      highlight.style.width=r.width+'px';highlight.style.height=r.height+'px';
      what.textContent=humanLabel(el);
    },{passive:true});
    overlay.addEventListener('pointerup',(ev:PointerEvent)=>{
      // The instruction bar is chrome, not a target: clicking it must not anchor.
      if((ev.target as HTMLElement).closest('.pickbar')){
        if((ev.target as HTMLElement).closest('.pickcancel'))stop();
        return;
      }
      ev.preventDefault();
      overlay.remove();highlight.remove();removeEventListener('keydown',onKey,true);fab.classList.remove('away');
      const el=under(ev.clientX,ev.clientY);
      if(!el){panel.classList.remove('hidden');return;}
      const r=el.getBoundingClientRect();
      anchor={selector:selectorFor(el),label:humanLabel(el),relative:{x:Math.max(0,Math.min(1,(ev.clientX-r.left)/Math.max(1,r.width))),y:Math.max(0,Math.min(1,(ev.clientY-r.top)/Math.max(1,r.height)))},viewport:{width:innerWidth,height:innerHeight}};
      pin?.remove();pin=document.createElement('div');pin.className='pin';pin.textContent='1';
      pin.title='Cliquer pour retirer l’épingle (Échap)';
      pin.style.left=ev.clientX+'px';pin.style.top=ev.clientY+'px';
      pin.addEventListener('click',(e)=>{
        e.stopPropagation();
        cancelAnchor();
      });
      root.append(pin);
      syncAnchorUi();clearError();panel.classList.remove('hidden');
      textarea.focus();
      if(check.checked)refreshDiag();
    });
  }

  // -------------------------------------------------------------- panel state

  const composeView=panel.querySelector('.view-compose') as HTMLElement;
  const sentView=panel.querySelector('.view-sent') as HTMLElement;
  const mineView=panel.querySelector('.view-mine') as HTMLElement;
  const mineList=panel.querySelector('.mine') as HTMLElement;
  const tabCompose=panel.querySelector('.tab-compose') as HTMLButtonElement;
  const tabMine=panel.querySelector('.tab-mine') as HTMLButtonElement;
  const tabBadge=panel.querySelector('.tab .badge') as HTMLElement;
  const fabBadge=fab.querySelector('.badge') as HTMLElement;

  const tabs=panel.querySelector('.tabs') as HTMLElement;

  function showView(which:'compose'|'sent'|'mine'){
    composeView.classList.toggle('hidden',which!=='compose');
    sentView.classList.toggle('hidden',which!=='sent');
    mineView.classList.toggle('hidden',which!=='mine');
    tabCompose.setAttribute('aria-pressed',String(which!=='mine'));
    tabMine.setAttribute('aria-pressed',String(which==='mine'));
    tabs.classList.toggle('on-mine',which==='mine');
    if(which==='mine')void loadMine();
  }

  const openPanel=()=>{panel.classList.remove('hidden');void countReplies();};
  const closePanel=()=>panel.classList.add('hidden');
  fab.addEventListener('click',openPanel);
  panel.querySelector('.close')!.addEventListener('click',closePanel);
  targetBtn.addEventListener('click',pick);
  tabCompose.addEventListener('click',()=>showView('compose'));
  tabMine.addEventListener('click',()=>showView('mine'));
  panel.querySelector('.again')!.addEventListener('click',()=>showView('compose'));
  panel.querySelector('.goto-mine')!.addEventListener('click',()=>showView('mine'));

  const isTyping=(e:Event):boolean=>{
    const target=(e.composedPath?.()[0]||e.target) as HTMLElement|null;
    if(!target)return false;
    const tag=target.tagName?.toLowerCase();
    return tag==='input'||tag==='textarea'||tag==='select'||Boolean(target.isContentEditable);
  };

  addEventListener('keydown',(ev:KeyboardEvent)=>{
    if(ev.defaultPrevented)return;
    const inPicker=Boolean(root.querySelector('.pick'));
    if(inPicker)return;

    // Escape handling: cancel anchor if set, or close panel
    if(ev.key==='Escape'){
      if(!panel.classList.contains('hidden')){
        ev.preventDefault();
        if(anchor){
          cancelAnchor();
        }else{
          closePanel();
        }
      }
      return;
    }

    const typing=isTyping(ev);
    if(typing){
      if(ev.altKey&&['1','2','3','4'].includes(ev.key)){
        const idx=parseInt(ev.key,10)-1;
        if(chips[idx]){
          ev.preventDefault();
          chips[idx].click();
        }
      }
      return;
    }

    if(ev.metaKey||ev.ctrlKey||ev.altKey)return;

    if(ev.key==='c'||ev.key==='C'){
      ev.preventDefault();
      if(panel.classList.contains('hidden')){
        openPanel();
      }else{
        closePanel();
      }
      return;
    }

    if(ev.key==='p'||ev.key==='P'){
      ev.preventDefault();
      pick();
      return;
    }

    if(!panel.classList.contains('hidden')&&['1','2','3','4'].includes(ev.key)){
      const idx=parseInt(ev.key,10)-1;
      if(chips[idx]){
        ev.preventDefault();
        chips[idx].click();
      }
    }
  });
  textarea.addEventListener('keydown',(ev)=>{
    if(ev.key==='Enter'&&(ev.metaKey||ev.ctrlKey)){ev.preventDefault();sendBtn.click();}
  });
  textarea.addEventListener('input',()=>{
    syncChipsFromText();
    (panel.querySelector('.step-text') as HTMLElement).classList.toggle('done',textarea.value.trim().length>1);
    clearError();
  });

  // --------------------------------------------------------------- sending

  sendBtn.addEventListener('click',async()=>{
    if(!anchor){showError('Montrez d’abord l’endroit concerné (étape 1).');return;}
    if(textarea.value.trim().length<2){showError('Décrivez en une phrase ce qui ne va pas (étape 2).');textarea.focus();return;}
    clearError();
    sendBtn.disabled=true;sendBtn.textContent='Envoi…';
    try{
      let screenshotId:string|undefined;
      if(file.files?.[0]){
        const form=new FormData();form.append('file',file.files[0]);
        const up=await fetch(`${config.api}/api/uploads?projectId=${encodeURIComponent(config.projectId)}`,{method:'POST',headers:{Authorization:`Bearer ${config.token}`},body:form});
        if(!up.ok)throw new Error('UPLOAD_FAILED');
        screenshotId=(await up.json()).id;
      }
      // Only the selector and the relative point travel: the friendly label is
      // built from page text and stays on the reviewer's machine.
      const {selector,relative,viewport}=anchor;
      const response=await fetch(`${config.api}/api/feedback?projectId=${encodeURIComponent(config.projectId)}`,{method:'POST',headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json'},body:JSON.stringify({projectId:config.projectId,text:textarea.value,pageUrl:location.href,anchor:{selector,relative,viewport},diagnostics:check.checked?diagnostics():{},screenshotId})});
      if(!response.ok)throw new Error('SEND_FAILED');
      textarea.value='';setShot(null);chips.forEach(c=>c.classList.remove('selected'));
      pin?.remove();pin=null;anchor=null;syncAnchorUi();
      (panel.querySelector('.step-text') as HTMLElement).classList.remove('done');
      showView('sent');
    }catch{
      showError('Envoi impossible. Vérifiez votre connexion ou la validité de votre lien, puis réessayez.');
    }finally{
      sendBtn.disabled=false;sendBtn.textContent='Envoyer mon retour';
    }
  });

  // ------------------------------------------------------------------- tickets

  const STATUS:Record<string,string>={TODO:'À traiter',IN_PROGRESS:'En cours',REVIEW:'À valider',DONE:'Traité'};
  type Ticket={id:string;text:string;status:string;replyText:string;anchor?:{selector:string}};

  const listTickets=async():Promise<Ticket[]>=>{
    const response=await fetch(`${config.api}/api/feedback?projectId=${encodeURIComponent(config.projectId)}`,
      {headers:{Authorization:`Bearer ${config.token}`}});
    if(!response.ok)throw new Error('LIST_FAILED');
    return (await response.json() as {tickets:Ticket[]}).tickets;
  };

  /**
   * Nothing is fetched until the reviewer opens the widget: a preview page must
   * not pay a request for a panel nobody looked at.
   */
  async function countReplies(){
    try{
      const replies=(await listTickets()).filter(ticket=>ticket.replyText).length;
      for(const badge of [tabBadge,fabBadge]){
        if(!badge)continue;
        badge.textContent=String(replies);
        badge.classList.toggle('hidden',replies===0);
      }
    }catch{/* the badge is a nicety; a failed count must stay silent */}
  }

  /** Reads back what this link has already filed, plus any reply from the admin. */
  async function loadMine(){
    mineList.replaceChildren();
    const loading=document.createElement('div');loading.className='empty';loading.textContent='Chargement…';
    mineList.append(loading);
    try{
      const tickets=await listTickets();
      mineList.replaceChildren();
      if(!tickets.length){
        const empty=document.createElement('div');empty.className='empty';
        empty.textContent='Aucun retour envoyé pour l’instant. Vos retours et les réponses reçues s’afficheront ici.';
        mineList.append(empty);return;
      }
      for(const ticket of tickets){
        const item=document.createElement('div');item.className=`item ${ticket.status}`;
        const itemHead=document.createElement('div');itemHead.className='item-head';
        const status=document.createElement('div');status.className='st';
        status.textContent=STATUS[ticket.status]??ticket.status;
        itemHead.append(status);
        if(ticket.anchor?.selector){
          const locateBtn=document.createElement('button');locateBtn.type='button';locateBtn.className='locate-ticket';
          locateBtn.innerHTML=`${TARGET_SVG}<span>Localiser</span>`;
          locateBtn.title='Voir l’emplacement sur la page';
          locateBtn.addEventListener('click',()=>flashElement(ticket.anchor!.selector));
          itemHead.append(locateBtn);
        }
        const text=document.createElement('p');
        // textContent throughout: this is the reviewer's own text coming back.
        text.textContent=ticket.text;
        item.append(itemHead,text);
        if(ticket.replyText){
          const reply=document.createElement('div');reply.className='reply';
          const label=document.createElement('strong');label.textContent='Réponse de l’équipe';
          const body=document.createElement('span');body.textContent=ticket.replyText;
          reply.append(label,body);item.append(reply);
        }
        if(ticket.status==='REVIEW'){
          const reviewActions=document.createElement('div');reviewActions.className='review-actions';
          const btnValidate=document.createElement('button');btnValidate.type='button';btnValidate.className='btn-validate';
          btnValidate.textContent='✓ Valider la correction';
          const btnReopen=document.createElement('button');btnReopen.type='button';btnReopen.className='btn-reopen';
          btnReopen.textContent='↺ Demander un ajustement';
          reviewActions.append(btnValidate,btnReopen);

          const reopenBox=document.createElement('div');reopenBox.className='reopen-box hidden';
          reopenBox.innerHTML=`<textarea class="reopen-input" placeholder="Précisez ce qu'il reste à ajuster..."></textarea><div class="reopen-actions"><button type="button" class="reopen-cancel">Annuler</button><button type="button" class="reopen-submit">Envoyer</button></div>`;
          const reopenInput=reopenBox.querySelector('.reopen-input') as HTMLTextAreaElement;
          const reopenCancel=reopenBox.querySelector('.reopen-cancel') as HTMLButtonElement;
          const reopenSubmit=reopenBox.querySelector('.reopen-submit') as HTMLButtonElement;

          btnValidate.addEventListener('click',async()=>{
            btnValidate.disabled=true;btnReopen.disabled=true;btnValidate.textContent='Validation…';
            try{
              const res=await fetch(`${config.api}/api/feedback/${encodeURIComponent(ticket.id)}/resolve?projectId=${encodeURIComponent(config.projectId)}`,{
                method:'POST',
                headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json'},
                body:'{}',
              });
              if(!res.ok)throw new Error();
              ticket.status='DONE';
              item.className='item DONE';
              status.textContent=STATUS.DONE ?? 'Traité';
              reviewActions.remove();reopenBox.remove();
              const notice=document.createElement('div');notice.className='action-notice done';
              notice.textContent='✓ Correction validée avec succès';
              item.append(notice);
              void countReplies();
            }catch{
              btnValidate.disabled=false;btnReopen.disabled=false;btnValidate.textContent='✓ Valider la correction';
              showError('Impossible de valider. Réessayez.');
            }
          });

          btnReopen.addEventListener('click',()=>{
            reviewActions.classList.add('hidden');
            reopenBox.classList.remove('hidden');
            reopenInput.focus();
          });

          reopenCancel.addEventListener('click',()=>{
            reopenBox.classList.add('hidden');
            reviewActions.classList.remove('hidden');
          });

          reopenSubmit.addEventListener('click',async()=>{
            const comment=reopenInput.value.trim();
            reopenSubmit.disabled=true;reopenSubmit.textContent='Envoi…';
            try{
              const res=await fetch(`${config.api}/api/feedback/${encodeURIComponent(ticket.id)}/reopen?projectId=${encodeURIComponent(config.projectId)}`,{
                method:'POST',
                headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json'},
                body:JSON.stringify({comment}),
              });
              if(!res.ok)throw new Error();
              ticket.status='TODO';
              item.className='item TODO';
              status.textContent=STATUS.TODO ?? 'À traiter';
              reviewActions.remove();reopenBox.remove();
              const notice=document.createElement('div');notice.className='action-notice reopened';
              notice.textContent='↺ Demande d’ajustement envoyée';
              item.append(notice);
              void countReplies();
            }catch{
              reopenSubmit.disabled=false;reopenSubmit.textContent='Envoyer';
              showError('Impossible d’envoyer la demande. Réessayez.');
            }
          });

          item.append(reviewActions,reopenBox);
        }
        mineList.append(item);
      }
    }catch{
      mineList.replaceChildren();
      const failed=document.createElement('div');failed.className='empty';
      failed.textContent='Liste indisponible. Vérifiez la validité de votre lien.';mineList.append(failed);
    }
  }

  syncAnchorUi();

  // ------------------------------------------------------- replayed anchor

  /**
   * The admin can deep-link straight to a ticket's spot. The anchor rides in the
   * fragment, which browsers never send to the client's server, so replaying a
   * pin leaves nothing in their access logs.
   */
  let replay:{selector:string;relative:{x:number;y:number}}|null=null;
  let replayPin:HTMLElement|null=null;
  try{
    const raw=new URLSearchParams(location.hash.slice(1)).get('rd-anchor');
    if(raw){
      const parsed=JSON.parse(raw) as {selector?:unknown;relative?:{x?:unknown;y?:unknown}};
      const x=Number(parsed.relative?.x),y=Number(parsed.relative?.y);
      if(typeof parsed.selector==='string'&&parsed.selector&&Number.isFinite(x)&&Number.isFinite(y)){
        replay={selector:parsed.selector,relative:{x,y}};
      }
    }
  }catch{replay=null;}
  if(replay){
    replayPin=document.createElement('div');replayPin.className='pin replay';replayPin.textContent='◎';
    replayPin.title='Retour signalé ici';root.append(replayPin);
  }

  const place=(node:HTMLElement,spec:{selector:string;relative:{x:number;y:number}})=>{
    let el:Element|null=null;
    try{el=document.querySelector(spec.selector);}catch{el=null;}
    if(!el){node.classList.add('missing');node.textContent='!';node.title='Élément d’origine introuvable';return;}
    const r=el.getBoundingClientRect();
    node.style.left=(r.left+r.width*spec.relative.x)+'px';
    node.style.top=(r.top+r.height*spec.relative.y)+'px';
  };

  const reposition=()=>{
    if(anchor&&pin)place(pin,anchor);
    if(replay&&replayPin)place(replayPin,replay);
  };
  addEventListener('resize',reposition,{passive:true});
  addEventListener('scroll',reposition,{passive:true,capture:true});

  if(replay){
    // Layout settles after fonts and images; place once now and once after.
    reposition();
    try{document.querySelector(replay.selector)?.scrollIntoView({block:'center',behavior:'smooth'});}catch{/* invalid selector */}
    setTimeout(reposition,600);
  }

  // Ping the server to check for replies and touch the reviewer token's
  // lastUsedAt, enabling the admin onboarding wizard to confirm installation.
  void countReplies();
}

/**
 * One-line integration: the client pastes a single <script> tag with its data
 * attributes and nothing else. Hand-writing an init() call was the step people
 * got wrong, and it is the only step a CMS or a tag manager makes awkward.
 */
const script = document.currentScript as HTMLScriptElement | null;
if (script?.dataset.project && script.dataset.token) {
  const boot = () => init({
    api: script.dataset.api || new URL(script.src, location.href).origin,
    projectId: script.dataset.project!,
    token: script.dataset.token!,
    label: script.dataset.label,
    theme: script.dataset.theme === 'dark' || script.dataset.theme === 'light' ? script.dataset.theme : 'auto',
    position: script.dataset.position === 'bottom-left' ? 'bottom-left' : 'bottom-right',
    accent: script.dataset.accent,
  });
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
}
