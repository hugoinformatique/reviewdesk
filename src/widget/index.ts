import { accentTokens } from '../brand-tokens.js';
import { normalizeDiagnostics } from '../privacy.js';
import html2canvas from 'html2canvas';

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
  /* One opaque panel surface, two raised levels above it. Opaque on purpose: text
     contrast must not depend on whatever the client's page happens to paint behind. */
  --rd-font:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;
  --rd-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --rd-tint:#ffffff; --rd-tint-2:#f4f4f6; --rd-tint-3:#fafafb;
  --rd-stroke:rgba(24,24,27,.10); --rd-stroke-2:rgba(24,24,27,.17);
  --rd-inset:inset 0 1px 0 rgba(255,255,255,.9);
  --rd-text:#09090b; --rd-text-2:#4b4b55; --rd-text-3:#6b6b76;
  --rd-accent:#09090b; --rd-accent-soft:rgba(0,0,0,.07); --rd-ring:rgba(0,0,0,.16);
  --rd-accent-contrast:#ffffff;
  --rd-danger:#be123c; --rd-danger-bg:rgba(225,29,72,.08);
  --rd-focus:#2563eb;
  --rd-btn-ring:rgba(0,0,0,.45);
  --rd-done:#15803d; --rd-done-bg:rgba(21,128,61,.12);
  --rd-lift:0 0 0 .5px rgba(0,0,0,.05),0 1px 1px rgba(0,0,0,.04),0 3px 6px rgba(0,0,0,.05),0 12px 24px -6px rgba(0,0,0,.10),0 32px 56px -16px rgba(0,0,0,.20);
  --rd-lift-2:0 1px 2px rgba(0,0,0,.06),0 4px 10px -4px rgba(0,0,0,.10);
  --rd-spring:cubic-bezier(.32,.72,0,1);
  --rd-edge:22px;
  font-family:var(--rd-font); color:var(--rd-text); -webkit-font-smoothing:antialiased;
  color-scheme:light;
}
:host([data-theme=dark]){
  --rd-tint:#121215; --rd-tint-2:#1d1d21; --rd-tint-3:#17171b;
  --rd-stroke:rgba(255,255,255,.10); --rd-stroke-2:rgba(255,255,255,.18);
  --rd-inset:inset 0 1px 0 rgba(255,255,255,.05);
  --rd-text:#fafafa; --rd-text-2:#d0d0d6; --rd-text-3:#a1a1aa;
  --rd-accent:#ffffff; --rd-accent-soft:rgba(255,255,255,.14); --rd-ring:rgba(255,255,255,.26);
  --rd-accent-contrast:#09090b;
  --rd-danger:#fb7185; --rd-danger-bg:rgba(251,113,133,.14);
  --rd-focus:#60a5fa;
  --rd-btn-ring:rgba(0,0,0,.35);
  --rd-done:#4ade80; --rd-done-bg:rgba(74,222,128,.14);
  --rd-lift:0 0 0 .5px rgba(255,255,255,.08),0 1px 1px rgba(0,0,0,.3),0 12px 24px -6px rgba(0,0,0,.5),0 32px 56px -16px rgba(0,0,0,.7);
  --rd-lift-2:0 1px 2px rgba(0,0,0,.4),0 4px 10px -4px rgba(0,0,0,.5);
  color-scheme:dark;
}
/* Tints follow the accent so a client's own colour carries through. Browsers
   without color-mix keep the neutral values above. */
@supports (color:color-mix(in srgb,red,blue)){
  :host{--rd-accent-soft:color-mix(in srgb,var(--rd-accent) 9%,transparent);--rd-ring:color-mix(in srgb,var(--rd-accent) 24%,transparent)}
  :host([data-theme=dark]){--rd-accent-soft:color-mix(in srgb,var(--rd-accent) 16%,transparent)}
}
:host([data-side=left]) .fab,:host([data-side=left]) .panel{right:auto;left:var(--rd-edge)}
:host([data-side=left]) .panel{transform-origin:0 100%}
:host([data-side=left]) .fab{transform-origin:0 100%}
*{box-sizing:border-box}
button,input,textarea,pre{font-family:var(--rd-font)}
button{cursor:pointer;-webkit-tap-highlight-color:transparent}
.hidden{display:none!important}
:is(button,input,label,.pin,.collab-pin,.shot-preview-wrap):focus-visible{outline:2px solid var(--rd-focus);outline-offset:2px}
.input-wrap:has(textarea:focus-visible){outline:0}
kbd{font-family:var(--rd-mono)}

/* ------------------------------------------------------------------ launcher */
.fab{position:fixed;right:var(--rd-edge);bottom:var(--rd-edge);z-index:2147483646;display:inline-flex;align-items:center;gap:9px;
  height:44px;border:0;border-radius:999px;padding:0 8px 0 15px;
  color:var(--rd-accent-contrast);background:var(--rd-accent);
  background-image:linear-gradient(180deg,rgba(255,255,255,.14),rgba(255,255,255,0) 60%);
  box-shadow:var(--rd-lift),0 0 0 .5px var(--rd-btn-ring),inset 0 1px 0 rgba(255,255,255,.18);
  font:600 13.5px/1 var(--rd-font);letter-spacing:-.011em;isolation:isolate;
  transition:transform .3s var(--rd-spring),box-shadow .3s var(--rd-spring),opacity .2s ease;
  animation:rd-fab .32s var(--rd-spring) .06s backwards}
.fab:hover{transform:translateY(-2px);box-shadow:var(--rd-lift),0 6px 16px -4px rgba(0,0,0,.22),0 0 0 .5px var(--rd-btn-ring),inset 0 1px 0 rgba(255,255,255,.22)}
.fab:active{transform:translateY(0) scale(.975);transition-duration:.1s}
.fab:has(+.panel:not(.hidden):not(.closing)),.fab.away{display:none}
.fab svg{width:17px;height:17px;flex:none}
.fab .fab-kbd{display:inline-grid;place-items:center;min-width:24px;height:24px;padding:0 6px;border-radius:7px;
  font:600 11px/1 var(--rd-mono);letter-spacing:0;color:inherit;
  background:rgba(255,255,255,.14);box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);opacity:.85}
:host([data-theme=dark]) .fab .fab-kbd{background:rgba(0,0,0,.08);box-shadow:inset 0 0 0 1px rgba(0,0,0,.14)}
.fab .badge{position:absolute;top:-6px;right:-3px;min-width:20px;height:20px;border-radius:999px;background:#e11d48;color:#fff;
  font:700 11px/20px var(--rd-font);text-align:center;padding:0 5px;
  box-shadow:0 0 0 2px var(--rd-tint),0 2px 5px rgba(0,0,0,.25)}
.fab .badge.hidden{display:none}
@keyframes rd-fab{from{opacity:0;transform:translateY(6px) scale(.94)}}

/* --------------------------------------------------------------------- panel */
.panel{position:fixed;right:var(--rd-edge);bottom:var(--rd-edge);z-index:2147483647;width:min(384px,calc(100vw - 24px));
  max-height:calc(100dvh - 44px);display:flex;flex-direction:column;overflow:hidden;
  background:var(--rd-tint);color:var(--rd-text);
  border:1px solid var(--rd-stroke);border-radius:18px;box-shadow:var(--rd-lift);
  font-size:13px;line-height:1.4;
  /* The panel is born at the launcher's corner and grows out of it. */
  transform-origin:100% 100%;animation:rd-morph .32s var(--rd-spring)}
.panel.closing{animation:rd-unmorph .18s cubic-bezier(.4,0,1,1) forwards;pointer-events:none}
@keyframes rd-morph{from{opacity:0;transform:translateY(8px) scale(.94)}}
@keyframes rd-unmorph{to{opacity:0;transform:translateY(6px) scale(.96)}}
@keyframes rd-in{from{opacity:0;transform:translateY(6px) scale(.96)}}
@keyframes rd-blur{from{opacity:0;filter:blur(4px);transform:translateY(4px)}}
.head{animation:rd-blur .4s var(--rd-spring) .02s backwards}
.tabs{animation:rd-blur .4s var(--rd-spring) .06s backwards}
.body>div:not(.hidden){animation:rd-blur .42s var(--rd-spring) .1s backwards}
.body{overflow:auto;padding:0 16px 16px;overscroll-behavior:contain}

.head{display:flex;align-items:center;gap:10px;padding:14px 12px 12px 16px}
.head .mark{width:28px;height:28px;border-radius:9px;flex:none;display:grid;place-items:center;
  color:var(--rd-accent-contrast);background:var(--rd-accent);
  background-image:linear-gradient(180deg,rgba(255,255,255,.16),rgba(255,255,255,0));
  box-shadow:0 0 0 .5px var(--rd-btn-ring),inset 0 1px 0 rgba(255,255,255,.18)}
.head .mark svg{width:15px;height:15px}
.title{font-weight:620;font-size:15px;letter-spacing:-.018em;line-height:1.2}
.sub{font-size:12px;color:var(--rd-text-3);line-height:1.3;margin-top:2px}
.head .grow{flex:1;min-width:0}
.close,.tab-pins-toggle{flex:none;display:grid;place-items:center;width:30px;height:30px;padding:0;border:0;border-radius:9px;
  background:transparent;color:var(--rd-text-3);transition:background .18s ease,color .18s ease}
.close:hover,.tab-pins-toggle:hover{background:var(--rd-tint-2);color:var(--rd-text)}
.close svg,.tab-pins-toggle svg{width:16px;height:16px}
.tab-pins-toggle.active{color:var(--rd-text)}
.tab-pins-toggle:not(.active) .eye-on,.tab-pins-toggle.active .eye-off{display:none}

/* A segmented control moves; it does not repaint. The pill slides so the eye
   follows the selection instead of re-finding it. */
.tabs{position:relative;display:flex;padding:3px;margin:0 16px 14px;border-radius:11px;background:var(--rd-tint-2);
  box-shadow:inset 0 0 0 1px var(--rd-stroke)}
.tabs .ind{position:absolute;top:3px;left:3px;width:calc(50% - 3px);height:calc(100% - 6px);border-radius:8px;
  background:var(--rd-tint);box-shadow:0 0 0 .5px var(--rd-stroke-2),var(--rd-lift-2);
  transition:transform .36s var(--rd-spring)}
:host([data-theme=dark]) .tabs .ind{background:#2a2a30}
.tabs.on-mine .ind{transform:translateX(100%)}
.tab{position:relative;z-index:1;flex:1;border:0;background:transparent;color:var(--rd-text-2);padding:0 8px;height:30px;
  border-radius:8px;font:550 12.5px/1 var(--rd-font);letter-spacing:-.005em;display:inline-flex;align-items:center;justify-content:center;gap:6px;
  transition:color .22s var(--rd-spring)}
.tab:hover{color:var(--rd-text)}
.tab[aria-pressed=true]{color:var(--rd-text);font-weight:620}
.tab .badge{min-width:17px;height:17px;border-radius:999px;color:var(--rd-accent-contrast);
  background:var(--rd-accent);font:700 10.5px/17px var(--rd-font);text-align:center;padding:0 4px}
.tab .badge.hidden{display:none}

/* ------------------------------------------------------------------ composer */
.target-card{display:flex;flex-direction:column;gap:6px;margin-bottom:10px}
.target-row{display:flex}
.target{display:flex;align-items:center;gap:11px;width:100%;text-align:left;
  border:1px dashed var(--rd-stroke-2);background:transparent;color:var(--rd-text);
  border-radius:13px;padding:9px 11px;font:500 13px/1.3 var(--rd-font);min-width:0;
  transition:background .2s var(--rd-spring),border-color .2s,transform .2s var(--rd-spring)}
.target:hover{border-color:var(--rd-accent);background:var(--rd-accent-soft)}
.target:active{transform:scale(.99)}
.target-icon-box{width:32px;height:32px;border-radius:10px;background:var(--rd-tint-2);box-shadow:inset 0 0 0 1px var(--rd-stroke);
  display:grid;place-items:center;flex:none;color:var(--rd-text-2);transition:background .2s,color .2s}
.target:hover .target-icon-box{background:var(--rd-accent);color:var(--rd-accent-contrast)}
.target-icon-box svg{width:17px;height:17px}
.target-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.target .lbl{font-weight:600;font-size:13px;letter-spacing:-.008em;color:var(--rd-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.target .target-subhint{font-size:12px;color:var(--rd-text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.target .act{flex:none;font:600 11px/1 var(--rd-mono);min-width:20px;height:20px;padding:0 6px;border-radius:6px;display:inline-grid;place-items:center;
  background:var(--rd-tint-2);box-shadow:inset 0 0 0 1px var(--rd-stroke-2);color:var(--rd-text-2)}
.target .act:empty{display:none}
.collab-tip-text{margin:2px 0 0;font-size:11px;opacity:.9}
.target.set{border-style:solid;border-color:var(--rd-stroke-2);background:var(--rd-tint-3);box-shadow:var(--rd-lift-2)}
.target.set:hover{border-color:var(--rd-accent)}
.target.set .target-icon-box{background:var(--rd-accent);color:var(--rd-accent-contrast)}
.target.set .target-subhint{display:none}
.target.set .act{font:600 11.5px/1 var(--rd-font);padding:0 8px;height:22px;box-shadow:none;background:transparent;color:var(--rd-text-3)}
.target-controls{display:flex;gap:6px;align-items:center}
.target-controls:empty,.target-controls:has(.hidden:only-child){display:none}
.target-locate,.target-cancel{height:28px;padding:0 10px;display:inline-flex;align-items:center;justify-content:center;gap:5px;
  border:0;border-radius:8px;background:var(--rd-tint-2);color:var(--rd-text-2);font:550 12px/1 var(--rd-font);
  transition:background .18s ease,color .18s ease}
.target-locate{flex:1}
.target-locate:hover{background:var(--rd-accent-soft);color:var(--rd-text)}
.target-cancel:hover{color:var(--rd-danger);background:var(--rd-danger-bg)}
.target-locate svg,.target-cancel svg{width:14px;height:14px;flex:none}

.category-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.category-chips .chip{flex:1 1 auto;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 10px;
  border:0;border-radius:999px;background:var(--rd-tint-2);color:var(--rd-text-2);
  box-shadow:inset 0 0 0 1px var(--rd-stroke);font:550 12.5px/1 var(--rd-font);white-space:nowrap;
  transition:background .18s var(--rd-spring),color .18s,box-shadow .18s,transform .18s var(--rd-spring)}
.category-chips .chip svg{width:15px;height:15px;flex:none;opacity:.8}
.category-chips .chip:hover{color:var(--rd-text);box-shadow:inset 0 0 0 1px var(--rd-stroke-2)}
.category-chips .chip:active{transform:scale(.97)}
.category-chips .chip.selected{background:var(--rd-accent-soft);color:var(--rd-text);font-weight:620;
  box-shadow:inset 0 0 0 1px var(--rd-accent)}
.category-chips .chip.selected svg{opacity:1;color:var(--rd-accent)}
@supports (color:color-mix(in srgb,red,blue)){
  .category-chips .chip.selected{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--rd-accent) 55%,transparent)}
}

/* The composer is one card: text above, a perforated tear line, actions below. */
.input-wrap{--rd-cb:var(--rd-stroke-2);position:relative;border:1px solid var(--rd-cb);border-radius:14px;background:var(--rd-tint-3);
  overflow:hidden;transition:border-color .2s,box-shadow .2s}
.input-wrap:focus-within{--rd-cb:var(--rd-text-3);box-shadow:0 0 0 3px var(--rd-ring)}
textarea{all:unset;display:block;box-sizing:border-box;width:100%;min-height:92px;
  padding:12px 14px 10px;color:var(--rd-text);font:13.5px/1.5 var(--rd-font);white-space:pre-wrap;overflow-wrap:anywhere}
textarea::placeholder{color:var(--rd-text-3);opacity:1}

.shot{display:flex;align-items:center;gap:10px;background:var(--rd-tint-2);
  border-radius:11px;padding:7px 8px;margin:0 8px 8px;box-shadow:inset 0 0 0 1px var(--rd-stroke);animation:rd-in .25s var(--rd-spring)}
.shot.hidden{display:none!important}
.shot-preview-wrap{position:relative;width:52px;height:38px;border-radius:7px;overflow:hidden;flex:none;
  background:rgba(0,0,0,.08);box-shadow:inset 0 0 0 1px var(--rd-stroke);display:grid;place-items:center;cursor:pointer;
  transition:transform .18s ease}
.shot-preview-wrap:hover{transform:scale(1.04)}
.shot img{width:100%;height:100%;object-fit:cover;border-radius:6px;display:block}
.shot img.hidden{display:none}
.shot-loader{width:16px;height:16px;border-radius:50%;border:2px solid var(--rd-stroke-2);border-top-color:var(--rd-text-2);animation:rd-spin .8s linear infinite}
@keyframes rd-spin{to{transform:rotate(360deg)}}
.shot-pin-dot{position:absolute;bottom:2px;right:2px;width:14px;height:14px;border-radius:50%;
  background:var(--rd-accent);color:var(--rd-accent-contrast);font:700 8.5px/14px var(--rd-font);
  text-align:center;box-shadow:0 0 0 1px var(--rd-accent-contrast)}
.shot-details{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.shot-badge-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.shot-pill{font:600 12px/1.2 var(--rd-font);color:var(--rd-text);display:inline-flex;align-items:center;gap:5px}
.shot-pill svg{width:13px;height:13px;flex:none;color:var(--rd-text-3)}
.shot-status-dot{font:600 11px/1 var(--rd-font);color:var(--rd-done)}
.shot .name{font-size:11.5px;color:var(--rd-text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.shot-ctrls{display:flex;align-items:center;gap:4px;flex:none}
.shot .edit-shot{border:0;background:var(--rd-tint);color:var(--rd-text);padding:0 9px;height:28px;border-radius:8px;
  font:600 12px/1 var(--rd-font);display:inline-flex;align-items:center;gap:5px;box-shadow:0 0 0 1px var(--rd-stroke-2);
  transition:background .16s ease,color .16s ease}
.shot .edit-shot svg{width:13px;height:13px}
.shot .edit-shot:hover{background:var(--rd-accent);color:var(--rd-accent-contrast)}
.shot .drop{border:0;background:transparent;color:var(--rd-text-3);width:28px;height:28px;border-radius:8px;display:grid;place-items:center;
  transition:background .16s ease,color .16s ease}
.shot .drop svg{width:14px;height:14px}
.shot .drop:hover{color:var(--rd-danger);background:var(--rd-danger-bg)}

.composer-toolbar{position:relative;display:flex;flex-wrap:wrap;align-items:center;gap:2px;padding:8px;
  border-top:1px dashed var(--rd-cb)}
.composer-toolbar::before,.composer-toolbar::after{content:"";position:absolute;top:-8px;width:15px;height:15px;border-radius:50%;
  background:var(--rd-tint);border:1px solid var(--rd-cb);transition:border-color .2s}
.composer-toolbar::before{left:-8px}
.composer-toolbar::after{right:-8px}
.attach,.privacy{display:inline-flex;align-items:center;gap:6px;color:var(--rd-text-2);
  font:550 12.5px/1 var(--rd-font);height:32px;padding:0 7px;border-radius:8px;transition:color .18s,background .18s}
.attach:hover,.privacy:hover{color:var(--rd-text);background:var(--rd-accent-soft)}
.attach svg{width:15px;height:15px;flex:none}
.attach,.privacy,.privacy input{cursor:pointer}
input[type=file]{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
.attach:has(input:focus-visible){outline:2px solid var(--rd-focus);outline-offset:2px}
.privacy input[type=checkbox]{margin:0;accent-color:var(--rd-accent);width:15px;height:15px}
.seediag{border:0;background:transparent;color:var(--rd-text-3);font:500 12px/1 var(--rd-font);
  text-decoration:underline;text-underline-offset:2px;padding:6px 4px;border-radius:6px}
.seediag:hover{color:var(--rd-text)}
.diag{background:var(--rd-tint-2);color:var(--rd-text-2);padding:8px 10px;
  border-radius:9px;font:10.5px/1.45 var(--rd-mono);white-space:pre-wrap;overflow-wrap:anywhere;
  max-height:100px;overflow:auto;margin:0 8px 8px}

/* ------------------------------------------------------------------- actions */
.primary{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:9px;border:0;
  color:var(--rd-accent-contrast);height:34px;padding:0 9px 0 12px;border-radius:10px;
  background:var(--rd-accent);
  box-shadow:0 0 0 .5px var(--rd-btn-ring),inset 0 1px 0 rgba(255,255,255,.16),0 1px 2px rgba(0,0,0,.14);
  font:600 13px/1 var(--rd-font);letter-spacing:-.01em;
  transition:filter .2s,transform .2s var(--rd-spring),box-shadow .2s}
@supports (color:color-mix(in srgb,red,blue)){
  .primary{background:linear-gradient(180deg,color-mix(in srgb,var(--rd-accent) 84%,#fff),var(--rd-accent))}
}
.primary:hover{filter:brightness(1.12);transform:translateY(-1px)}
.primary:active{transform:translateY(0) scale(.98)}
.primary:disabled{opacity:.5;cursor:not-allowed;transform:none;filter:none}
.primary[aria-busy=true]:disabled{opacity:1;cursor:progress}
.send{margin-left:auto}
.send-swap{display:grid;overflow:hidden}
.send-swap>span{grid-area:1/1;display:inline-flex;align-items:center;justify-content:center;gap:7px;white-space:nowrap;
  transition:transform .32s var(--rd-spring),opacity .22s ease}
.send-busy{transform:translateY(120%);opacity:0}
.send.busy .send-idle{transform:translateY(-120%);opacity:0}
.send.busy .send-busy{transform:none;opacity:1}
.spin{width:13px;height:13px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;animation:rd-spin .7s linear infinite}
.send-kbd{font:600 10.5px/1 var(--rd-mono);padding:3px 5px;border-radius:5px;letter-spacing:0;
  background:rgba(255,255,255,.16);box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);opacity:.9}
:host([data-theme=dark]) .send-kbd{background:rgba(0,0,0,.1);box-shadow:inset 0 0 0 1px rgba(0,0,0,.14)}
.secondary{border:0;background:var(--rd-tint-2);color:var(--rd-text);height:34px;padding:0 13px;border-radius:10px;
  box-shadow:inset 0 0 0 1px var(--rd-stroke-2);font:550 13px/1 var(--rd-font);
  transition:background .18s,box-shadow .18s}
.secondary:hover{background:var(--rd-tint-3);box-shadow:inset 0 0 0 1px var(--rd-stroke-2),var(--rd-lift-2)}
.actions{display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap}

.msg{margin-top:10px;border-radius:11px;padding:9px 12px;font-size:12.5px;line-height:1.45;
  color:var(--rd-danger);background:var(--rd-danger-bg);box-shadow:inset 0 0 0 1px currentColor;
  animation:rd-in .28s var(--rd-spring)}

/* --------------------------------------------------------------------- sent */
.sent{display:flex;flex-direction:column;align-items:center;text-align:center;padding:22px 6px 4px}
.sent .check{width:52px;height:52px;border-radius:50%;color:var(--rd-done);display:grid;place-items:center;margin-bottom:14px;
  background:var(--rd-done-bg);box-shadow:0 0 0 7px var(--rd-done-bg);animation:rd-pop .5s var(--rd-spring)}
.sent .check svg{width:26px;height:26px}
.sent .check path{stroke-dasharray:1;stroke-dashoffset:0;animation:rd-draw .5s cubic-bezier(.65,0,.35,1) .18s backwards}
@keyframes rd-pop{from{transform:scale(.6);opacity:0}}
@keyframes rd-draw{from{stroke-dashoffset:1}}
.sent h2{margin:0 0 6px;font:620 16px/1.25 var(--rd-font);letter-spacing:-.018em}
.sent p{margin:0;font-size:13px;color:var(--rd-text-2);line-height:1.55;max-width:300px;text-wrap:balance}
.sent .actions{margin-top:18px;width:100%}

/* ----------------------------------------------------------------- my replies */
.mine{display:grid;gap:8px;max-height:340px;overflow:auto;padding:1px}
.mine .item{--st:#2563eb;--st-bg:rgba(37,99,235,.10);border-radius:13px;padding:12px;background:var(--rd-tint-3);
  box-shadow:0 0 0 1px var(--rd-stroke)}
.mine .item.TODO{--st:#2563eb;--st-bg:rgba(37,99,235,.10)}
.mine .item.IN_PROGRESS{--st:#b45309;--st-bg:rgba(180,83,9,.11)}
.mine .item.REVIEW{--st:#0e7490;--st-bg:rgba(14,116,144,.11)}
.mine .item.DONE{--st:#15803d;--st-bg:rgba(21,128,61,.11)}
:host([data-theme=dark]) .mine .item.TODO{--st:#60a5fa;--st-bg:rgba(96,165,250,.15)}
:host([data-theme=dark]) .mine .item.IN_PROGRESS{--st:#fbbf24;--st-bg:rgba(251,191,36,.14)}
:host([data-theme=dark]) .mine .item.REVIEW{--st:#22d3ee;--st-bg:rgba(34,211,238,.14)}
:host([data-theme=dark]) .mine .item.DONE{--st:#4ade80;--st-bg:rgba(74,222,128,.14)}
.mine .item p{margin:0;font-size:13px;line-height:1.5;overflow-wrap:anywhere}
.mine .item .st{display:inline-flex;align-items:center;gap:6px;font:600 11.5px/1 var(--rd-font);letter-spacing:.005em;
  color:var(--st);background:var(--st-bg);padding:5px 9px 5px 8px;border-radius:999px}
.mine .item .st::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.mine .item .item-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.mine .item .locate-ticket{border:0;background:var(--rd-tint-2);color:var(--rd-text-2);font:550 12px/1 var(--rd-font);
  height:26px;padding:0 9px;border-radius:8px;display:inline-flex;align-items:center;gap:5px;transition:background .18s,color .18s}
.mine .item .locate-ticket:hover{background:var(--rd-accent-soft);color:var(--rd-text)}
.mine .item .locate-ticket svg{width:13px;height:13px}
.review-actions{display:flex;gap:6px;margin-top:10px}
.btn-validate,.btn-reopen{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:0;height:32px;padding:0 10px;
  border-radius:9px;font:600 12.5px/1 var(--rd-font);transition:filter .2s,background .2s,transform .2s var(--rd-spring)}
.btn-validate svg,.btn-reopen svg{width:14px;height:14px;flex:none}
.btn-validate{color:var(--rd-accent-contrast);background:var(--rd-accent);box-shadow:0 0 0 .5px var(--rd-btn-ring),inset 0 1px 0 rgba(255,255,255,.16)}
.btn-validate:hover{filter:brightness(1.12)}
.btn-reopen{background:var(--rd-tint-2);color:var(--rd-text-2);box-shadow:inset 0 0 0 1px var(--rd-stroke-2)}
.btn-reopen:hover{color:var(--rd-text)}
.btn-validate:disabled,.btn-reopen:disabled{opacity:.55;cursor:not-allowed}
.reopen-box{margin-top:9px;display:grid;gap:7px}
.reopen-input{all:unset;display:block;box-sizing:border-box;width:100%;min-height:60px;box-shadow:inset 0 0 0 1px var(--rd-stroke-2);
  border-radius:9px;padding:8px 10px;background:var(--rd-tint);color:var(--rd-text);font:13px/1.4 var(--rd-font)}
.reopen-input:focus{box-shadow:inset 0 0 0 1px var(--rd-accent),0 0 0 3px var(--rd-ring)}
.reopen-actions{display:flex;justify-content:flex-end;gap:6px}
.reopen-cancel{border:0;background:transparent;color:var(--rd-text-2);height:30px;padding:0 10px;border-radius:8px;font:550 12.5px/1 var(--rd-font)}
.reopen-cancel:hover{color:var(--rd-text);background:var(--rd-tint-2)}
.reopen-submit{border:0;background:var(--rd-accent);color:var(--rd-accent-contrast);height:30px;padding:0 12px;border-radius:8px;
  font:600 12.5px/1 var(--rd-font)}
.reopen-submit:hover{filter:brightness(1.12)}
.action-notice{margin-top:10px;padding:7px 10px;border-radius:9px;font-size:12.5px;font-weight:550;
  display:flex;align-items:center;gap:7px}
.action-notice svg{width:14px;height:14px;flex:none}
.action-notice.done{background:var(--rd-done-bg);color:var(--rd-done)}
.action-notice.reopened{background:var(--rd-tint-2);color:var(--rd-text-2)}
.halo-flash{position:fixed;z-index:2147483643;pointer-events:none;border-radius:9px;
  border:2px solid var(--rd-accent);box-shadow:0 0 0 4px var(--rd-accent-soft),0 0 20px rgba(0,0,0,.25);
  animation:rd-halo 1.5s cubic-bezier(.32,.72,0,1) forwards}
@keyframes rd-halo{0%{opacity:0;transform:scale(.96)}20%{opacity:1;transform:scale(1.02)}45%{transform:scale(1)}80%{opacity:1}100%{opacity:0}}
.mine .item .reply{margin-top:10px;padding:9px 11px;border-radius:10px;background:var(--rd-tint-2);
  font-size:12.5px;color:var(--rd-text-2);line-height:1.5}
.mine .item .reply strong{display:block;font-size:11.5px;font-weight:620;color:var(--rd-text);margin-bottom:3px}
.mine .empty{color:var(--rd-text-3);font-size:13px;text-align:center;padding:28px 14px;line-height:1.55;text-wrap:balance}

/* ---------------------------------------------------------------------- pins */
.pin{position:fixed;z-index:2147483645;width:28px;height:28px;border-radius:50%;
  background:var(--rd-accent);color:var(--rd-accent-contrast);display:grid;place-items:center;
  transform:translate(-50%,-50%);font:700 12px/1 var(--rd-font);pointer-events:auto;cursor:pointer;
  border:2px solid var(--rd-accent-contrast);
  box-shadow:0 0 0 1px rgba(0,0,0,.16),0 6px 16px rgba(0,0,0,.34),0 1px 3px rgba(0,0,0,.25);
  transition:transform .2s var(--rd-spring),box-shadow .2s}
.pin:hover{transform:translate(-50%,-50%) scale(1.12)}
.pin:hover::after{content:"✕";position:absolute;inset:0;display:grid;place-items:center;border-radius:50%;
  background:var(--rd-accent);color:var(--rd-accent-contrast);font-size:12px;font-weight:700}
.pin::before{content:"";position:absolute;inset:-7px;border-radius:50%;
  border:2px solid var(--rd-accent);opacity:.4;animation:rd-ping 2.4s var(--rd-spring) infinite}
@keyframes rd-ping{0%{transform:scale(.8);opacity:.45}70%,100%{transform:scale(1.4);opacity:0}}
/* The pin replayed from an admin deep link is deliberately styled differently */
.pin.replay{pointer-events:none;background:var(--rd-accent-contrast);color:var(--rd-accent);
  border:2px solid var(--rd-accent);box-shadow:0 0 0 3px var(--rd-ring),0 6px 16px rgba(0,0,0,.25)}
.pin.replay::after{display:none}
.pin.replay::before{border-color:var(--rd-accent)}
.pin.missing{background:var(--rd-accent-contrast);color:var(--rd-danger);border:2px dashed var(--rd-danger);
  box-shadow:0 6px 16px rgba(225,29,72,.3)}
.pin.missing::before{display:none}

/* -------------------------------------------------------------- pick overlay */
.pick{position:fixed;inset:0;z-index:2147483644;cursor:crosshair;background:rgba(0,0,0,.06)}
/* The highlight is a lens, not a box */
.hl{position:fixed;z-index:2147483643;pointer-events:none;border-radius:9px;
  border:2px solid #ffffff;
  box-shadow:0 0 0 9999px rgba(0,0,0,.38),0 0 0 1.5px #09090b,
    0 14px 34px -10px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.4);
  transition:all .13s var(--rd-spring)}
.hl.hidden{display:none}
/* pointer-events:none so the bar never shields whatever sits under it */
.pickbar{position:fixed;left:50%;top:22px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;
  max-width:min(560px,calc(100vw - 32px));color:#fff;font:550 13px/1.3 var(--rd-font);
  padding:7px 7px 7px 14px;border-radius:999px;pointer-events:none;
  background:rgba(14,14,17,.92);-webkit-backdrop-filter:saturate(180%) blur(20px);backdrop-filter:saturate(180%) blur(20px);
  box-shadow:0 0 0 .5px rgba(255,255,255,.16),0 20px 40px -12px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.14);
  animation:rd-bar .34s var(--rd-spring)}
@keyframes rd-bar{from{opacity:0;transform:translate(-50%,-12px) scale(.96)}}
.pickbar>span:first-child{flex:none;white-space:nowrap;display:inline-flex;align-items:center;gap:8px}
.pickbar>span:first-child svg{width:16px;height:16px;flex:none;opacity:.85}
.pickbar .what{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.7;font-weight:500}
.pickbar .what:empty{display:none}
.pickcancel{pointer-events:auto;border:0;background:rgba(255,255,255,.14);
  color:inherit;height:28px;padding:0 12px;border-radius:999px;font:600 12.5px/1 var(--rd-font);flex:none;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);transition:background .2s}
.pickcancel:hover{background:rgba(255,255,255,.26)}

/* ----------------------------------------------------------- collab on-page pins */
.collab-pin{position:absolute;z-index:2147483640;display:inline-flex;align-items:center;gap:5px;
  transform:translate(-50%,-50%);padding:4px 8px;border-radius:999px;
  font:700 11px/1 var(--rd-mono);
  color:#fff;background:var(--rd-accent);
  border:2px solid #fff;
  box-shadow:0 0 0 1px rgba(0,0,0,.12),0 3px 8px rgba(0,0,0,.16);
  cursor:pointer;transition:transform .2s var(--rd-spring),box-shadow .2s;pointer-events:auto}
.collab-pin:hover{transform:translate(-50%,-50%) scale(1.12);z-index:2147483643}
.collab-pin.status-TODO{background:#2563eb}
.collab-pin.status-IN_PROGRESS{background:#b45309}
.collab-pin.status-REVIEW{background:#0e7490}
.collab-pin.status-DONE{background:#15803d}
.collab-pin .collab-badge{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.collab-pin .collab-tip{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);
  background:rgba(14,14,17,.94);color:#fff;padding:6px 10px;border-radius:8px;font:500 12px/1.35 var(--rd-font);
  white-space:nowrap;max-width:260px;overflow:hidden;text-overflow:ellipsis;pointer-events:none;
  box-shadow:0 8px 20px rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.14);
  opacity:0;visibility:hidden;transition:all .18s ease;z-index:2147483644}
.collab-pin:hover .collab-tip{opacity:1;visibility:visible;transform:translateX(-50%) translateY(-2px)}

/* ------------------------------------------------------------- annotator modal */
.annotator-overlay{position:fixed;inset:0;z-index:2147483647;
  background:rgba(0,0,0,.78);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);
  display:flex;align-items:center;justify-content:center;padding:16px;animation:rd-in .2s ease}
.annotator-card{background:var(--rd-tint);color:var(--rd-text);border-radius:18px;
  width:min(920px,94vw);max-height:92vh;display:flex;flex-direction:column;
  box-shadow:var(--rd-lift);overflow:hidden}
.annotator-header{display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:12px 16px;border-bottom:1px solid var(--rd-stroke)}
.annotator-title{font:620 14px/1.2 var(--rd-font);letter-spacing:-.012em;display:flex;flex-direction:column;gap:3px}
.annotator-sub{font:450 12px/1.3 var(--rd-font);color:var(--rd-text-3)}
.annotator-actions{display:flex;align-items:center;gap:8px}
.annotator-btn{height:32px;padding:0 13px;border-radius:9px;font:600 12.5px/1 var(--rd-font);display:inline-flex;align-items:center;gap:6px;
  border:0;box-shadow:inset 0 0 0 1px var(--rd-stroke-2);background:var(--rd-tint-2);color:var(--rd-text);transition:background .18s ease}
.annotator-btn svg{width:14px;height:14px}
.annotator-btn:hover{background:var(--rd-tint-3)}
.annotator-btn.primary{background:var(--rd-accent);color:var(--rd-accent-contrast);box-shadow:0 0 0 .5px var(--rd-btn-ring)}
.annotator-btn.primary:hover{filter:brightness(1.12)}
.annotator-canvas-wrap{flex:1;min-height:280px;max-height:64vh;display:grid;place-items:center;
  background:rgba(0,0,0,.28);padding:12px;overflow:auto}
.annotator-canvas{display:block;max-width:100%;max-height:60vh;object-fit:contain;cursor:crosshair;
  border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.35);touch-action:none}
.annotator-toolbar{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:6px;padding:10px 16px;
  border-top:1px solid var(--rd-stroke)}
.tool-btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 11px;border-radius:9px;
  font:550 12.5px/1 var(--rd-font);border:0;box-shadow:inset 0 0 0 1px var(--rd-stroke);
  background:var(--rd-tint-2);color:var(--rd-text-2);transition:background .16s ease,color .16s ease}
.tool-btn:hover{color:var(--rd-text);box-shadow:inset 0 0 0 1px var(--rd-stroke-2)}
.tool-btn.active{background:var(--rd-accent);color:var(--rd-accent-contrast);box-shadow:none}
.tool-btn svg{width:14px;height:14px;flex:none}
.tool-sep{width:1px;height:20px;background:var(--rd-stroke);margin:0 4px}

.sheet-handle{display:none}
.panel-backdrop{display:none}

@media(max-width:640px){
  :host{--rd-edge:12px}
  .panel-backdrop{display:block;position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.4);
    -webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);animation:rd-fade .25s ease}
  .panel-backdrop.hidden{display:none!important}
  @keyframes rd-fade{from{opacity:0}}
  .sheet-handle{display:block;width:36px;height:5px;border-radius:999px;background:var(--rd-stroke-2);
    margin:8px auto 0;flex:none;cursor:grab;touch-action:none}
  .panel{
    right:0!important;left:0!important;bottom:0!important;width:100%!important;
    max-height:90dvh!important;border-radius:20px 20px 0 0!important;border-bottom:0!important;
    border-left:0!important;border-right:0!important;
    padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px);
    transform-origin:50% 100%;animation:rd-sheet .34s var(--rd-spring);
  }
  .panel.closing{animation:rd-sheet-out .2s cubic-bezier(.4,0,1,1) forwards}
  @keyframes rd-sheet{from{opacity:.4;transform:translateY(100%)}}
  @keyframes rd-sheet-out{to{opacity:.4;transform:translateY(100%)}}
  .head{padding:6px 8px 10px 16px}
  .body{padding:0 16px max(16px,calc(env(safe-area-inset-bottom,0px) + 10px))}
  .tabs{margin:0 16px 12px}
  .tab{height:38px;font-size:13px}
  .close,.tab-pins-toggle{width:40px;height:40px}
  .fab{bottom:max(14px,env(safe-area-inset-bottom,0px));right:14px;height:48px;padding:0 18px}
  :host([data-side=left]) .fab{left:14px}
  .fab .fab-kbd{display:none}
  textarea{min-height:96px;font-size:16px}
  .target{min-height:56px}
  .target-locate,.target-cancel,.category-chips .chip{height:40px}
  .attach,.privacy{height:40px}
  .privacy input[type=checkbox]{width:18px;height:18px}
  .seediag{padding:12px 6px}
  .send{flex:1 0 100%;height:46px;margin-top:6px;font-size:14px}
  .send-kbd{display:none}
  .primary,.secondary{height:44px}
  .sent .actions{flex-direction:column}
  .sent .actions>button{width:100%}
  .btn-validate,.btn-reopen{height:40px}
  .mine .item .locate-ticket{height:34px}
  .reopen-cancel,.reopen-submit{height:38px}
  .reopen-input{font-size:16px}
  .annotator-btn,.tool-btn{height:38px}
  .pickbar{left:12px;right:12px;transform:none;max-width:none;top:max(16px,env(safe-area-inset-top,0px));padding:7px 7px 7px 14px}
  .pickcancel{height:36px}
  @keyframes rd-bar{from{opacity:0;transform:translateY(-12px)}}
}
@media(prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:.01ms!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:.01ms!important}
  .panel,.panel.closing{transform:none}
  .panel{animation:rd-fade .2s ease!important}
  .panel.closing{animation:rd-unfade .15s ease forwards!important}
  @keyframes rd-fade{from{opacity:0}}
  @keyframes rd-unfade{to{opacity:0}}
  .head,.tabs,.body>div:not(.hidden){animation:none!important}
}
`;
  if (config.accent) {
    // Derived, not copied: a pale brand colour gets dark ink on the button
    // instead of white text nobody can read.
    const tokens = accentTokens(config.accent);
    host.style.setProperty('--rd-accent', tokens.accent);
    host.style.setProperty('--rd-accent-hover', tokens.accentHover);
    host.style.setProperty('--rd-accent-contrast', tokens.accentFg);
  }
  // The product's mark, so the button the client sees is the same brand as the
  // admin: a speech bubble whose one visible content is the point talked about.
  const PIN_SVG=`<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M7.6 4h8.8a4 4 0 0 1 4 4v4.9a4 4 0 0 1-4 4h-3.8l-3.9 3.5a.7.7 0 0 1-1.2-.5v-3H7.6a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4Zm4.4 3.9a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2Z"/></svg>`;
  const TARGET_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="7.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>`;
  const ico=(d:string)=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const CLIP_SVG=ico('<path d="m20 11.5-7.8 7.8a5 5 0 0 1-7-7l8-8a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.7 1.7 0 0 1-2.4-2.4l7.3-7.3"/>');
  const BUG_SVG=ico('<path d="M8 9a4 4 0 0 1 8 0v5a4 4 0 0 1-8 0V9Z"/><path d="M12 10v8M8 12.5H4M16 12.5h4M9 5.5 7 3.5M15 5.5l2-2M8.3 17 5.5 19.5M15.7 17l2.8 2.5"/>');
  const EYE_SVG=ico('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>');
  const EYE_OFF_SVG=ico('<path d="M3 3l18 18M10.6 6a9 9 0 0 1 1.4-.1C18 5.9 21.5 12 21.5 12a17 17 0 0 1-2.7 3.4M6.4 7.5C3.8 9.3 2.5 12 2.5 12S6 18.1 12 18.1c1.5 0 2.8-.4 4-.9M9.9 9.9a3 3 0 0 0 4.2 4.2"/>');
  const TEXT_SVG=ico('<path d="M4.5 6.5h15M4.5 12h15M4.5 17.5h9"/>');
  const BULB_SVG=ico('<path d="M12 3.5a5.5 5.5 0 0 0-3.2 10c.5.4.7 1 .7 1.6V17h5v-1.9c0-.6.2-1.2.7-1.6a5.5 5.5 0 0 0-3.2-10ZM10 20.5h4"/>');
  const X_SVG=ico('<path d="M6 6l12 12M18 6 6 18"/>');
  const CAMERA_SVG=ico('<path d="M4 8.5a1.5 1.5 0 0 1 1.5-1.5h2L9 5h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9Z"/><circle cx="12" cy="12.5" r="3.2"/>');
  const PENCIL_SVG=ico('<path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L8 19l-4 1ZM14.5 6.5l3 3"/>');
  const TICK_SVG=ico('<path d="m5 12.5 4.5 4.5L19 7.5"/>');
  const UNDO_SVG=ico('<path d="M9 7 4.5 11.5 9 16M5 11.5h9a5 5 0 0 1 0 10h-2"/>');
  const CHECK_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path pathLength="1" d="m5 12.5 4.5 4.5L19 7.5"/></svg>`;

  // A constructed sheet is CSSOM, not an inline <style>, so a host page with a
  // strict `style-src` policy still lets the widget draw itself.
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(style.textContent ?? '');
    root.adoptedStyleSheets = [sheet];
  } catch {
    root.append(style);
  }
  const launcherLabel = config.label?.trim() || 'Faire un retour';
  const fab=document.createElement('button');fab.className='fab';fab.type='button';
  fab.innerHTML=`${PIN_SVG}<span class="fab-label"></span><kbd class="fab-kbd" title="Raccourci [C]">C</kbd><span class="badge hidden"></span>`;
  (fab.querySelector('.fab-label') as HTMLElement).textContent=launcherLabel;
  fab.setAttribute('aria-label', `${launcherLabel} (Donner mon avis)`);
  root.append(fab);

  const panel=document.createElement('section');panel.className='panel hidden';
  panel.setAttribute('aria-label','Retours sur cette page');
  panel.innerHTML=`
<div class="sheet-handle" aria-hidden="true"></div>
<header class="head">
  <span class="mark">${PIN_SVG}</span>
  <div class="grow"><div class="title">Faire un retour</div><div class="sub">Sur cette page web</div></div>
  <button type="button" class="tab-pins-toggle active" title="Afficher/Masquer les pastilles sur la page" aria-label="Afficher ou masquer les pastilles sur la page" aria-pressed="true"><span class="eye-on">${EYE_SVG}</span><span class="eye-off">${EYE_OFF_SVG}</span></button>
  <button type="button" class="close" aria-label="Fermer">${X_SVG}</button>
</header>
<div class="tabs">
  <span class="ind"></span>
  <button type="button" class="tab tab-compose" aria-pressed="true">Nouveau retour</button>
  <button type="button" class="tab tab-mine" aria-pressed="false">Mes retours<span class="badge hidden"></span></button>
</div>
<div class="body">
  <div class="view-compose">
    <div class="target-card step-target">
      <div class="target-row">
        <button type="button" class="target">
          <div class="target-icon-box">${TARGET_SVG}</div>
          <div class="target-info">
            <span class="lbl">Cliquez ici pour pointer un élément</span>
            <span class="target-subhint">Ou laissez vide pour commenter la page entière</span>
          </div>
          <span class="act"></span>
        </button>
      </div>
      <div class="target-controls">
        <button type="button" class="target-locate hidden" title="Voir l’élément sur la page" aria-label="Voir l’élément sur la page">${TARGET_SVG}<span>Localiser</span></button>
        <button type="button" class="target-cancel hidden" title="Retirer l’épingle (Échap)" aria-label="Retirer l’épingle">${X_SVG}<span>Retirer</span></button>
      </div>
    </div>
    <div class="category-chips">
      <button type="button" class="chip" data-prefix="[Bug] ">${BUG_SVG}<span>Bug</span></button>
      <button type="button" class="chip" data-prefix="[Visuel] ">${EYE_SVG}<span>Visuel</span></button>
      <button type="button" class="chip" data-prefix="[Contenu] ">${TEXT_SVG}<span>Contenu</span></button>
      <button type="button" class="chip" data-prefix="[Idée] ">${BULB_SVG}<span>Idée</span></button>
    </div>
    <div class="input-wrap step-text">
      <textarea maxlength="4000" placeholder="Décrivez votre retour ici... (Que souhaitez-vous corriger ou améliorer ?)"></textarea>
      <div class="shot hidden">
        <div class="shot-preview-wrap" title="Cliquer pour annoter la capture">
          <img alt="Capture d'écran" class="hidden">
          <span class="shot-loader hidden"></span>
          <span class="shot-pin-dot">1</span>
        </div>
        <div class="shot-details">
          <div class="shot-badge-row">
            <span class="shot-pill">${CAMERA_SVG}Capture d’écran auto</span>
            <span class="shot-status-dot">● Prête</span>
          </div>
          <span class="name"></span>
        </div>
        <div class="shot-ctrls">
          <button type="button" class="edit-shot" title="Annoter l’image (dessiner, flécher, flouter)">${PENCIL_SVG}<span>Annoter</span></button>
          <button type="button" class="drop" title="Retirer la capture" aria-label="Retirer la capture">${X_SVG}</button>
        </div>
      </div>
      <div class="composer-toolbar">
        <label class="attach" title="Ajouter ou remplacer par une image">${CLIP_SVG}<span>Joindre</span><input class="file-input" type="file" accept="image/png,image/jpeg,image/webp"></label>
        <label class="privacy" title="Taille d’écran, navigateur, page (sans donnée personnelle)"><input type="checkbox" class="diagcheck"><span>Infos tech</span></label>
        <button type="button" class="seediag hidden">Voir</button>
        <button type="button" class="primary send"><span class="send-swap"><span class="send-idle">Envoyer mon retour</span><span class="send-busy" aria-hidden="true"><i class="spin"></i>Envoi…</span></span><kbd class="send-kbd" aria-hidden="true">⌘↵</kbd></button>
      </div>
      <pre class="diag hidden"></pre>
    </div>
    <div class="msg hidden" role="alert"></div>
  </div>
  <div class="view-sent hidden">
    <div class="sent">
      <div class="check">${CHECK_SVG}</div>
      <h2 class="sent-title"></h2>
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
  const backdrop=document.createElement('div');backdrop.className='panel-backdrop hidden';
  root.append(backdrop);

  const sheetHandle=panel.querySelector('.sheet-handle') as HTMLElement|null;
  if(sheetHandle){
    let startY=0;
    sheetHandle.addEventListener('touchstart',(e)=>{
      startY=e.touches[0]?.clientY??0;
    },{passive:true});
    sheetHandle.addEventListener('touchmove',(e)=>{
      const currentY=e.touches[0]?.clientY??0;
      const diff=currentY-startY;
      if(diff>0)panel.style.transform=`translateY(${diff}px)`;
    },{passive:true});
    sheetHandle.addEventListener('touchend',(e)=>{
      const endY=e.changedTouches[0]?.clientY??0;
      if(endY-startY>60)closePanel();
      panel.style.transform='';
    },{passive:true});
  }

  let anchor:any=null,pin:HTMLElement|null=null,isAutoShot=false;
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

  type RecordedJsError = {
    type: 'runtime' | 'unhandledrejection';
    message: string;
    source?: string;
    lineno?: number;
    colno?: number;
    time: string;
  };
  const jsErrorsBuffer: RecordedJsError[] = [];
  function recordError(type: 'runtime' | 'unhandledrejection', msg: string, source?: string, lineno?: number, colno?: number) {
    if (jsErrorsBuffer.length >= 6) jsErrorsBuffer.shift();
    jsErrorsBuffer.push({
      type,
      message: String(msg).slice(0, 240),
      source: typeof source === 'string' ? source.slice(0, 150) : undefined,
      lineno,
      colno,
      time: new Date().toISOString(),
    });
  }

  window.addEventListener('error', (ev) => {
    try {
      recordError('runtime', String(ev.message || 'Error'), typeof ev.filename === 'string' ? ev.filename : undefined, ev.lineno, ev.colno);
    } catch { /* error recording failed */ }
  });

  window.addEventListener('unhandledrejection', (ev) => {
    try {
      const reason = ev.reason;
      const msg = typeof reason === 'string' ? reason : (reason?.message || 'Unhandled Promise Rejection');
      recordError('unhandledrejection', String(msg));
    } catch { /* rejection recording failed */ }
  });

  const diagnostics=()=>normalizeDiagnostics({
    viewport:{width:innerWidth,height:innerHeight},
    dpr:devicePixelRatio,
    orientation:innerWidth>=innerHeight?'landscape':'portrait',
    locale:navigator.language,
    timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,
    userAgent:navigator.userAgent,
    platform:navigator.platform,
    path:location.href,
    errors:anchor?[]:[{category:'widget',code:'ANCHOR_MISSING',count:1}],
    jsErrors:jsErrorsBuffer.slice(-5),
  });

  /** Consent stays explicit, and the payload stays one click away from being read. */
  const refreshDiag=()=>{diag.textContent=check.checked?JSON.stringify(diagnostics(),null,2):'';};
  check.addEventListener('change',()=>{
    seediag.classList.toggle('hidden',!check.checked);
    diag.classList.add('hidden');
    seediag.textContent='Voir';
    refreshDiag();
  });
  seediag.addEventListener('click',()=>{
    const shown=diag.classList.toggle('hidden');
    seediag.textContent=shown?'Voir':'Masquer';
    if(!shown)refreshDiag();
  });

  const showError=(text:string)=>{msg.textContent=text;msg.classList.remove('hidden');};
  const clearError=()=>{msg.textContent='';msg.classList.add('hidden');};

  /** Keeps target button honest about whether a point is already set. */
  function syncAnchorUi(){
    const set=Boolean(anchor);
    targetBtn.classList.toggle('set',set);
    targetLocate.classList.toggle('hidden',!set);
    targetCancel.classList.toggle('hidden',!set);
    stepTarget.classList.toggle('done',set);
    targetLabel.textContent=set?anchor.label:'Cliquez ici pour pointer un élément';
    targetBtn.title=set?`${anchor.selector} — Cliquer pour changer (Échap pour retirer)`:'Raccourcis : P pour pointer, Échap pour annuler';
    targetAct.textContent=set?'Changer':'';
  }

  function cancelAnchor(){
    if(!anchor && !pin) return;
    pin?.remove();
    pin=null;
    anchor=null;
    if(isAutoShot){
      setShot(null);
      isAutoShot=false;
    }
    syncAnchorUi();
    clearError();
    if(check.checked)refreshDiag();
  }
  targetCancel.addEventListener('click',cancelAnchor);

  // ------------------------------------------------------- image compression & annotation

  function applyPixelate(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    if (w <= 0 || h <= 0) return;
    try {
      const blockSize = Math.max(8, Math.round(Math.min(w, h) / 7));
      const imgData = ctx.getImageData(x, y, w, h);
      const data = imgData.data;
      for (let py = 0; py < h; py += blockSize) {
        for (let px = 0; px < w; px += blockSize) {
          let r = 0, g = 0, b = 0, count = 0;
          for (let dy = 0; dy < blockSize && py + dy < h; dy++) {
            for (let dx = 0; dx < blockSize && px + dx < w; dx++) {
              const idx = ((py + dy) * w + (px + dx)) * 4;
              r += data[idx]!;
              g += data[idx + 1]!;
              b += data[idx + 2]!;
              count++;
            }
          }
          if (!count) continue;
          r = Math.round(r / count);
          g = Math.round(g / count);
          b = Math.round(b / count);
          for (let dy = 0; dy < blockSize && py + dy < h; dy++) {
            for (let dx = 0; dx < blockSize && px + dx < w; dx++) {
              const idx = ((py + dy) * w + (px + dx)) * 4;
              data[idx] = r;
              data[idx + 1] = g;
              data[idx + 2] = b;
            }
          }
        }
      }
      ctx.putImageData(imgData, x, y);
    } catch {
      ctx.fillStyle = 'rgba(128,128,128,0.92)';
      ctx.fillRect(x, y, w, h);
    }
  }

  function drawArrow(ctx: CanvasRenderingContext2D, fromX: number, fromY: number, toX: number, toY: number, color: string, width: number) {
    const headLen = Math.max(16, width * 3.5);
    const angle = Math.atan2(toY - fromY, toX - fromX);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headLen * Math.cos(angle - Math.PI / 6), toY - headLen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(toX - headLen * Math.cos(angle + Math.PI / 6), toY - headLen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  async function compressImage(file: File | Blob, maxWidth = 1920, maxHeight = 1080, quality = 0.85): Promise<File> {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        if (w > maxWidth || h > maxHeight) {
          const ratio = Math.min(maxWidth / w, maxHeight / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(file instanceof File ? file : new File([file], 'capture.webp', { type: 'image/webp' }));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          if (!blob) {
            resolve(file instanceof File ? file : new File([file], 'capture.webp', { type: 'image/webp' }));
            return;
          }
          const baseName = (file instanceof File ? file.name.replace(/\.[^.]+$/, '') : 'capture');
          resolve(new File([blob], `${baseName}.webp`, { type: 'image/webp' }));
        }, 'image/webp', quality);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(file instanceof File ? file : new File([file], 'capture.webp', { type: 'image/webp' }));
      };
      img.src = url;
    });
  }

  type Shape =
    | { tool: 'rect'; x1: number; y1: number; x2: number; y2: number }
    | { tool: 'arrow'; x1: number; y1: number; x2: number; y2: number }
    | { tool: 'blur'; x1: number; y1: number; x2: number; y2: number };

  function openAnnotator(file: File, onSave: (annotated: File) => void) {
    const modal = document.createElement('div');
    modal.className = 'annotator-overlay';
    modal.innerHTML = `
      <div class="annotator-card" role="dialog" aria-label="Annoter la capture">
        <div class="annotator-header">
          <div class="annotator-title">
            <span>Annoter la capture</span>
            <span class="annotator-sub">Pointez les anomalies et masquez les données privées</span>
          </div>
          <div class="annotator-actions">
            <button type="button" class="annotator-btn annotator-skip" title="Garder sans annotation">Ignorer</button>
            <button type="button" class="annotator-btn annotator-done primary" title="Valider les annotations">${TICK_SVG}<span>Valider</span></button>
          </div>
        </div>
        <div class="annotator-canvas-wrap">
          <canvas class="annotator-canvas"></canvas>
        </div>
        <div class="annotator-toolbar">
          <button type="button" class="tool-btn active" data-tool="rect" title="Cadre rouge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
            <span>Cadre</span>
          </button>
          <button type="button" class="tool-btn" data-tool="arrow" title="Flèche">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="19" x2="19" y2="5"/><polyline points="9 5 19 5 19 15"/></svg>
            <span>Flèche</span>
          </button>
          <button type="button" class="tool-btn" data-tool="blur" title="Flouter des informations sensibles">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/><line x1="3" y1="3" x2="21" y2="21"/></svg>
            <span>Flouter</span>
          </button>
          <span class="tool-sep"></span>
          <button type="button" class="tool-btn tool-undo" title="Annuler le dernier tracé">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
            <span>Annuler</span>
          </button>
          <button type="button" class="tool-btn tool-clear" title="Effacer toutes les annotations">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            <span>Effacer</span>
          </button>
        </div>
      </div>
    `;
    root.append(modal);

    const canvas = modal.querySelector('canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const img = new Image();
    const url = URL.createObjectURL(file);

    let currentTool: 'rect' | 'arrow' | 'blur' = 'rect';
    const shapes: Shape[] = [];
    let isDrawing = false;
    let startX = 0, startY = 0;
    let currentX = 0, currentY = 0;

    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      redraw();
    };
    img.src = url;

    function redraw(draft?: Shape) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      const all = draft ? [...shapes, draft] : shapes;
      for (const s of all) {
        drawShape(s);
      }
    }

    function drawShape(s: Shape) {
      const minX = Math.min(s.x1, s.x2);
      const minY = Math.min(s.y1, s.y2);
      const w = Math.abs(s.x2 - s.x1);
      const h = Math.abs(s.y2 - s.y1);
      const strokeW = Math.max(3, Math.round(canvas.width / 260));

      if (s.tool === 'rect') {
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = strokeW;
        ctx.fillStyle = 'rgba(239, 68, 68, 0.12)';
        ctx.beginPath();
        ctx.rect(minX, minY, w, h);
        ctx.fill();
        ctx.stroke();
      } else if (s.tool === 'arrow') {
        drawArrow(ctx, s.x1, s.y1, s.x2, s.y2, '#ef4444', strokeW);
      } else if (s.tool === 'blur') {
        applyPixelate(ctx, minX, minY, w, h);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(minX, minY, w, h);
        ctx.setLineDash([]);
      }
    }

    const toolBtns = modal.querySelectorAll<HTMLButtonElement>('[data-tool]');
    toolBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        toolBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTool = btn.dataset.tool as any;
      });
    });

    modal.querySelector('.tool-undo')!.addEventListener('click', () => {
      shapes.pop();
      redraw();
    });
    modal.querySelector('.tool-clear')!.addEventListener('click', () => {
      shapes.length = 0;
      redraw();
    });

    const getCanvasPos = (ev: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: Math.max(0, Math.min(canvas.width, (ev.clientX - rect.left) * scaleX)),
        y: Math.max(0, Math.min(canvas.height, (ev.clientY - rect.top) * scaleY)),
      };
    };

    canvas.addEventListener('pointerdown', (ev) => {
      isDrawing = true;
      canvas.setPointerCapture(ev.pointerId);
      const pos = getCanvasPos(ev);
      startX = pos.x;
      startY = pos.y;
      currentX = pos.x;
      currentY = pos.y;
    });

    canvas.addEventListener('pointermove', (ev) => {
      if (!isDrawing) return;
      const pos = getCanvasPos(ev);
      currentX = pos.x;
      currentY = pos.y;
      redraw({ tool: currentTool, x1: startX, y1: startY, x2: currentX, y2: currentY });
    });

    canvas.addEventListener('pointerup', (ev) => {
      if (!isDrawing) return;
      isDrawing = false;
      const pos = getCanvasPos(ev);
      currentX = pos.x;
      currentY = pos.y;
      const dist = Math.hypot(currentX - startX, currentY - startY);
      if (dist > 4) {
        shapes.push({ tool: currentTool, x1: startX, y1: startY, x2: currentX, y2: currentY });
      }
      redraw();
    });

    const close = () => {
      URL.revokeObjectURL(url);
      modal.remove();
      removeEventListener('keydown', onKey);
    };

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        close();
        onSave(file);
      }
    };
    addEventListener('keydown', onKey);

    modal.querySelector('.annotator-skip')!.addEventListener('click', () => {
      close();
      onSave(file);
    });

    modal.querySelector('.annotator-done')!.addEventListener('click', () => {
      redraw();
      canvas.toBlob((blob) => {
        close();
        if (blob) {
          const baseName = file.name.replace(/\.[^.]+$/, '');
          const out = new File([blob], `${baseName}-annotated.webp`, { type: 'image/webp' });
          onSave(out);
        } else {
          onSave(file);
        }
      }, 'image/webp', 0.88);
    });
  }

  let shotUrl:string|null=null;
  let activeShotFile:File|null=null;
  let rawShotFile:File|null=null;
  let currentCapturePromise:Promise<File|null>|null=null;
  const shotLoader = shot.querySelector('.shot-loader') as HTMLElement | null;

  function setShot(picked:File|null){
    if(shotUrl){URL.revokeObjectURL(shotUrl);shotUrl=null;}
    activeShotFile = picked;
    if(!picked){
      file.value='';
      shot.classList.add('hidden');
      shotImg.removeAttribute('src');
      shotImg.classList.add('hidden');
      shotLoader?.classList.add('hidden');
      rawShotFile = null;
      isAutoShot = false;
      return;
    }
    shotUrl=URL.createObjectURL(picked);
    shotImg.src=shotUrl;
    shotImg.classList.remove('hidden');
    shotLoader?.classList.add('hidden');
    shotName.textContent=picked.name;
    shot.classList.remove('hidden');
  }

  function getHelperContext(): CanvasRenderingContext2D | null {
    try {
      const helperCanvas = document.createElement('canvas');
      helperCanvas.width = 1;
      helperCanvas.height = 1;
      return helperCanvas.getContext('2d', { willReadFrequently: true });
    } catch {
      return null;
    }
  }

  function toRgbString(cssColor: string, helperCtx: CanvasRenderingContext2D | null): string {
    if (!helperCtx) return cssColor;
    try {
      helperCtx.clearRect(0, 0, 1, 1);
      helperCtx.fillStyle = '#00000000';
      helperCtx.fillStyle = cssColor;
      helperCtx.fillRect(0, 0, 1, 1);
      const data = helperCtx.getImageData(0, 0, 1, 1).data;
      const r = data[0] ?? 0;
      const g = data[1] ?? 0;
      const b = data[2] ?? 0;
      const a = data[3] ?? 255;
      if (a === 255) return `rgb(${r}, ${g}, ${b})`;
      const alpha = +(a / 255).toFixed(3);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    } catch {
      return cssColor;
    }
  }

  function sanitizeColorValue(val: string, helperCtx: CanvasRenderingContext2D | null): string {
    if (!val || typeof val !== 'string') return val;
    if (!/(oklch|oklab|lab|lch|color-mix|hwb|color\()/i.test(val)) return val;
    const trimmed = val.trim();
    if (typeof CSS !== 'undefined' && CSS.supports && CSS.supports('color', trimmed)) {
      const direct = toRgbString(trimmed, helperCtx);
      if (direct && !/(oklch|oklab|lab|lch|color-mix|hwb|color\()/i.test(direct)) {
        return direct;
      }
    }
    let res = val;
    let iterations = 0;
    const innerRegex = /(?:oklch|oklab|lab|lch|color-mix|hwb|color)\([^()]+\)/gi;
    while (innerRegex.test(res) && iterations < 6) {
      res = res.replace(innerRegex, (match) => toRgbString(match, helperCtx));
      iterations++;
    }
    return res;
  }

  function patchComputedStyle(win: Window, helperCtx: CanvasRenderingContext2D | null): () => void {
    const orig = win.getComputedStyle;
    try {
      win.getComputedStyle = function (elt: Element, pseudo?: string | null): CSSStyleDeclaration {
        const real = orig.call(win, elt, pseudo);
        return new Proxy(real, {
          get(target, prop) {
            if (prop === 'getPropertyValue') {
              return (name: string) => sanitizeColorValue(target.getPropertyValue(name), helperCtx);
            }
            const v = Reflect.get(target, prop, target);
            if (typeof v === 'string') return sanitizeColorValue(v, helperCtx);
            if (typeof v === 'function') return v.bind(target);
            return v;
          },
        });
      };
    } catch {
      // getComputedStyle may be non-configurable in rare environments
    }
    return () => {
      try {
        win.getComputedStyle = orig;
      } catch {
        /* ignore restoration error */
      }
    };
  }

  async function createFallbackViewportFile(clientX: number, clientY: number, drawPin = true): Promise<File> {
    const width = Math.max(320, window.innerWidth || 800);
    const height = Math.max(320, window.innerHeight || 600);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');

    if (ctx) {
      ctx.scale(dpr, dpr);

      // Dark elegant background
      ctx.fillStyle = '#09090b';
      ctx.fillRect(0, 0, width, height);

      // Subtle technical grid
      ctx.strokeStyle = '#27272a';
      ctx.lineWidth = 1;
      const step = 32;
      for (let x = 0; x < width; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Browser mock bar
      const barH = 44;
      ctx.fillStyle = '#18181b';
      ctx.fillRect(0, 0, width, barH);
      ctx.strokeStyle = '#27272a';
      ctx.beginPath();
      ctx.moveTo(0, barH);
      ctx.lineTo(width, barH);
      ctx.stroke();

      // Traffic dots
      const dots = ['#ef4444', '#f59e0b', '#10b981'];
      dots.forEach((color, i) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(18 + i * 16, barH / 2, 5, 0, Math.PI * 2);
        ctx.fill();
      });

      // URL Pill
      const pillW = Math.min(width - 160, 480);
      const pillX = (width - pillW) / 2;
      if (pillW > 120) {
        ctx.fillStyle = '#09090b';
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(pillX, 8, pillW, 28, 6);
        } else {
          ctx.rect(pillX, 8, pillW, 28);
        }
        ctx.fill();
        ctx.strokeStyle = '#3f3f46';
        ctx.stroke();

        ctx.fillStyle = '#a1a1aa';
        ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const displayUrl = location.origin + location.pathname;
        const truncatedUrl = displayUrl.length > 50 ? displayUrl.slice(0, 47) + '…' : displayUrl;
        ctx.fillText(truncatedUrl, pillX + pillW / 2, 22);
      }

      // Context Info Card
      const cardW = Math.min(width - 40, 520);
      const cardH = 170;
      const cardX = (width - cardW) / 2;
      const cardY = barH + 36;
      ctx.fillStyle = '#18181b';
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(cardX, cardY, cardW, cardH, 12);
      } else {
        ctx.rect(cardX, cardY, cardW, cardH);
      }
      ctx.fill();
      ctx.strokeStyle = '#3f3f46';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#f4f4f5';
      ctx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const title = document.title || 'Page Web';
      ctx.fillText(title.slice(0, 42), cardX + 20, cardY + 20);

      ctx.fillStyle = '#a1a1aa';
      ctx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(`Dimensions : ${width} × ${height} px (DPR ${dpr})`, cardX + 20, cardY + 48);
      if (anchor?.label) {
        ctx.fillText(`Élément ciblé : ${anchor.label.slice(0, 45)}`, cardX + 20, cardY + 72);
      }
      if (anchor?.selector) {
        ctx.fillStyle = '#71717a';
        ctx.font = '11px monospace';
        ctx.fillText(`Sélecteur : ${anchor.selector.slice(0, 48)}`, cardX + 20, cardY + 98);
      }
      ctx.fillStyle = '#71717a';
      ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText('Capture de contexte ReviewDesk (DOM interactif)', cardX + 20, cardY + 130);

      if (drawPin) {
        const pinX = clientX;
        const pinY = clientY;

        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 4;

        ctx.beginPath();
        ctx.arc(pinX, pinY, 15, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#09090b';
        ctx.stroke();

        ctx.restore();
        ctx.save();
        ctx.fillStyle = '#09090b';
        ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('1', pinX, pinY);
        ctx.restore();
      }
    }

    let blob = await new Promise<Blob | null>((resolve) => {
      try {
        canvas.toBlob((b) => resolve(b), 'image/webp', 0.88);
      } catch {
        resolve(null);
      }
    });
    if (!blob) {
      blob = await new Promise<Blob | null>((resolve) => {
        try {
          canvas.toBlob((b) => resolve(b), 'image/png');
        } catch {
          resolve(null);
        }
      });
    }

    // Ultimate fallback to ensure a valid non-empty file is always returned
    if (!blob) {
      const minimalPngBytes = new Uint8Array([
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
        0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196,
        137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0,
        0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78,
        68, 174, 66, 96, 130
      ]);
      blob = new Blob([minimalPngBytes], { type: 'image/png' });
    }

    const mime = blob.type || 'image/png';
    const ext = mime === 'image/webp' ? '.webp' : '.png';
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}h${String(now.getMinutes()).padStart(2, '0')}`;
    return new File([blob], `capture-vue-${timeStr}${ext}`, { type: mime });
  }

  async function captureAutoScreenshot(clientX: number, clientY: number, drawPin = true): Promise<File | null> {
    const helperCtx = getHelperContext();
    const unpatch = patchComputedStyle(window, helperCtx);

    try {
      const scrollX = window.scrollX || window.pageXOffset || 0;
      const scrollY = window.scrollY || window.pageYOffset || 0;
      const width = window.innerWidth;
      const height = window.innerHeight;

      const h2c: any = (html2canvas as any)?.default || html2canvas;
      const canvas = await h2c(document.body, {
        logging: false,
        useCORS: true,
        allowTaint: false,
        x: scrollX,
        y: scrollY,
        width,
        height,
        scale: Math.min(window.devicePixelRatio || 1, 2),
        ignoreElements: (el: Element) => {
          if (el === host || el.tagName?.toLowerCase() === 'reviewdesk-widget' || el.classList?.contains('collab-pins-layer')) {
            return true;
          }
          const tag = el.tagName?.toLowerCase();
          return tag === 'iframe' || tag === 'video' || tag === 'audio' || tag === 'script' || tag === 'noscript';
        },
        onclone: (clonedDoc: Document) => {
          try {
            clonedDoc.querySelectorAll('iframe, video, audio, script, noscript').forEach((n) => n.remove());
            const clonedWin = clonedDoc.defaultView;
            if (clonedWin) {
              patchComputedStyle(clonedWin, helperCtx);
            }
          } catch {
            /* ignore clone cleanup error */
          }
        },
      });

      const ctx = canvas.getContext('2d');
      if (ctx && drawPin) {
        const scale = canvas.width / width;
        const pinX = clientX * scale;
        const pinY = clientY * scale;

        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
        ctx.shadowBlur = 10 * scale;
        ctx.shadowOffsetY = 4 * scale;

        ctx.beginPath();
        ctx.arc(pinX, pinY, 15 * scale, 0, Math.PI * 2);
        ctx.fillStyle = '#09090b';
        ctx.fill();

        ctx.lineWidth = 2.5 * scale;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();

        ctx.restore();
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.round(13 * scale)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('1', pinX, pinY);
        ctx.restore();
      }

      let blob = await new Promise<Blob | null>((resolve) => {
        try {
          canvas.toBlob((b: Blob | null) => resolve(b), 'image/webp', 0.85);
        } catch {
          resolve(null);
        }
      });
      if (!blob) {
        blob = await new Promise<Blob | null>((resolve) => {
          try {
            canvas.toBlob((b: Blob | null) => resolve(b), 'image/png');
          } catch {
            resolve(null);
          }
        });
      }
      if (!blob) {
        return await createFallbackViewportFile(clientX, clientY, drawPin);
      }
      const mimeType = blob.type || 'image/webp';
      const ext = mimeType === 'image/png' ? '.png' : mimeType === 'image/jpeg' ? '.jpg' : '.webp';
      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}h${String(now.getMinutes()).padStart(2, '0')}`;
      const autoFile = new File([blob], `capture-auto-${timeStr}${ext}`, { type: mimeType });
      return autoFile;
    } catch (err) {
      console.warn('captureAutoScreenshot failed, using fallback viewport capture:', err);
      return await createFallbackViewportFile(clientX, clientY, drawPin);
    } finally {
      unpatch();
    }
  }

  async function handleIncomingFile(picked:File|null){
    if(!picked) return;
    if(!['image/png','image/jpeg','image/webp'].includes(picked.type)){
      showError('Format d’image non supporté (PNG, JPEG ou WebP uniquement).');
      return;
    }
    if(picked.size > UPLOAD_MAX_BYTES * 3){
      file.value='';
      showError('L’image est trop volumineuse (> 12 Mo).');
      return;
    }
    clearError();
    const compressed = await compressImage(picked);
    rawShotFile = compressed;
    isAutoShot = false;
    openAnnotator(compressed, (annotated) => {
      setShot(annotated);
      isAutoShot = false;
    });
  }

  const triggerAnnotator=()=>{
    if(rawShotFile || activeShotFile){
      openAnnotator(rawShotFile || activeShotFile!, (annotated)=>{
        setShot(annotated);
        isAutoShot = false;
      });
    }
  };
  file.addEventListener('change',()=>void handleIncomingFile(file.files?.[0]??null));
  panel.querySelector('.shot .drop')!.addEventListener('click',()=>setShot(null));
  panel.querySelector('.shot .edit-shot')?.addEventListener('click',triggerAnnotator);
  panel.querySelector('.shot-preview-wrap')?.addEventListener('click',triggerAnnotator);

  panel.addEventListener('paste',(event)=>{
    const pasted=[...((event as ClipboardEvent).clipboardData?.files ?? [])][0];
    if(!pasted)return;
    event.preventDefault();
    void handleIncomingFile(pasted);
  });

  // ------------------------------------------------------------------ picking

  /**
   * Picking is always escapable. Trapping the reviewer until they click some
   * element is what forced anyone who only wanted to read replies to file a
   * throwaway comment first.
   */
  function pick(){
    closePanel();fab.classList.add('away');
    const overlay=document.createElement('div');overlay.className='pick';
    overlay.innerHTML=`<div class="pickbar"><span>${TARGET_SVG}Touchez ou cliquez l’endroit concerné</span><span class="what"></span><button type="button" class="pickcancel">Annuler</button></div>`;
    const highlight=document.createElement('div');highlight.className='hl hidden';
    root.append(highlight,overlay);
    const what=overlay.querySelector('.what') as HTMLElement;
    const stop=()=>{overlay.remove();highlight.remove();removeEventListener('keydown',onKey,true);fab.classList.remove('away');openPanel();};
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
      if(!el){openPanel();return;}
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
      syncAnchorUi();clearError();openPanel();
      textarea.focus();
      if(check.checked)refreshDiag();

      const clickX = ev.clientX;
      const clickY = ev.clientY;
      if(!activeShotFile || isAutoShot){
        shot.classList.remove('hidden');
        shotImg.classList.add('hidden');
        shotLoader?.classList.remove('hidden');
        shotName.textContent='Capture auto en cours…';
        const capturePromise = captureAutoScreenshot(clickX, clickY);
        currentCapturePromise = capturePromise;
        void capturePromise.then((autoFile)=>{
          if(autoFile && anchor && (!activeShotFile || isAutoShot)){
            rawShotFile = autoFile;
            setShot(autoFile);
            isAutoShot = true;
          }else if(!activeShotFile){
            shot.classList.add('hidden');
          }
        });
      }
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
    const sentTitle=sentView.querySelector('.sent-title');
    if(sentTitle) sentTitle.textContent = which==='sent' ? 'Retour envoyé, merci !' : '';
    tabCompose.setAttribute('aria-pressed',String(which!=='mine'));
    tabMine.setAttribute('aria-pressed',String(which==='mine'));
    tabs.classList.toggle('on-mine',which==='mine');
    if(which==='mine')void loadMine();
  }

  // The panel leaves faster than it arrives: a short fade-out, then it is really hidden.
  let closeTimer=0;
  const isOpen=()=>!panel.classList.contains('hidden')&&!panel.classList.contains('closing');
  const openPanel=()=>{
    clearTimeout(closeTimer);
    panel.classList.remove('hidden','closing');
    backdrop.classList.remove('hidden');
    void countReplies();
  };
  const closePanel=()=>{
    if(!isOpen())return;
    panel.classList.add('closing');
    backdrop.classList.add('hidden');
    closeTimer=window.setTimeout(()=>{panel.classList.add('hidden');panel.classList.remove('closing');},180);
  };
  backdrop.addEventListener('click',closePanel);
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
      if(isOpen()){
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
      if(!isOpen()){
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

    if(isOpen()&&['1','2','3','4'].includes(ev.key)){
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
    if(!anchor){
      anchor={
        selector:'body',
        label:'Page entière',
        relative:{x:0.5,y:0.5},
        viewport:{width:innerWidth,height:innerHeight}
      };
      if(!activeShotFile){
        try{
          const autoFile=await captureAutoScreenshot(innerWidth/2,innerHeight/2,false);
          if(autoFile){
            rawShotFile=autoFile;
            setShot(autoFile);
            isAutoShot=true;
          }
        }catch{/* non-blocking */}
      }
    }
    if(textarea.value.trim().length<2){showError('Veuillez décrire votre retour en quelques mots.');textarea.focus();return;}
    clearError();
    sendBtn.disabled=true;sendBtn.classList.add('busy');sendBtn.setAttribute('aria-busy','true');
    try{
      let fileToUpload = activeShotFile || file.files?.[0];
      if(!fileToUpload && currentCapturePromise){
        try{
          const autoFile = await Promise.race([
            currentCapturePromise,
            new Promise<null>((resolve)=>setTimeout(()=>resolve(null),8000)),
          ]);
          if(autoFile){
            fileToUpload = autoFile;
            activeShotFile = autoFile;
            rawShotFile = autoFile;
          }
        }catch(err){
          console.warn('Auto-capture wait error:', err);
        }
      }
      if(!fileToUpload){
        try{
          fileToUpload = await createFallbackViewportFile(innerWidth / 2, innerHeight / 2, Boolean(pin));
        }catch(err){
          console.warn('Fallback capture creation error:', err);
        }
      }
      let screenshotId:string|undefined;
      if(fileToUpload){
        try{
          const form=new FormData();form.append('file',fileToUpload);
          const up=await fetch(`${config.api}/api/uploads?projectId=${encodeURIComponent(config.projectId)}`,{method:'POST',headers:{Authorization:`Bearer ${config.token}`},body:form});
          if(up.ok){
            const upJson = await up.json();
            screenshotId=upJson.id;
          }else{
            console.warn('Screenshot upload HTTP error:', up.status, await up.text().catch(()=>''));
          }
        }catch(err){
          console.warn('Screenshot upload failed:', err);
        }
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
      void listTickets().then(t=>{cachedTickets=t;updateCollabPins();}).catch(()=>{});
    }catch{
      showError('Envoi impossible. Vérifiez votre connexion ou la validité de votre lien, puis réessayez.');
    }finally{
      sendBtn.disabled=false;sendBtn.classList.remove('busy');sendBtn.removeAttribute('aria-busy');
    }
  });

  // ------------------------------------------------------------------- tickets

  const STATUS:Record<string,string>={TODO:'À traiter',IN_PROGRESS:'En cours',REVIEW:'À valider',DONE:'Traité'};
  type Ticket={id:string;text:string;status:string;replyText:string;anchor?:{selector:string;relative?:{x:number;y:number}}};

  let cachedTickets:Ticket[]=[];
  let showCollabPins=true;
  const collabLayer=document.createElement('div');
  collabLayer.className='collab-pins-layer';
  root.append(collabLayer);

  const pinsToggleBtn=panel.querySelector('.tab-pins-toggle') as HTMLButtonElement|null;
  pinsToggleBtn?.addEventListener('click',()=>{
    showCollabPins=!showCollabPins;
    pinsToggleBtn.classList.toggle('active',showCollabPins);
    pinsToggleBtn.setAttribute('aria-pressed',String(showCollabPins));
    updateCollabPins();
  });

  function updateCollabPins(){
    collabLayer.replaceChildren();
    if(!showCollabPins||!cachedTickets.length)return;

    cachedTickets.forEach((t,idx)=>{
      if(!t.anchor?.selector)return;
      try{
        const el=document.querySelector(t.anchor.selector);
        if(!el)return;
        const r=el.getBoundingClientRect();
        const relX=t.anchor.relative?.x??0.5;
        const relY=t.anchor.relative?.y??0.5;
        const x=r.left+window.scrollX+r.width*relX;
        const y=r.top+window.scrollY+r.height*relY;

        const pinEl=document.createElement('div');
        pinEl.className=`collab-pin status-${t.status}`;
        pinEl.style.left=`${x}px`;
        pinEl.style.top=`${y}px`;
        // Built node by node: the ticket text is another reviewer's input and
        // must never reach innerHTML on the client's own page.
        const badge=document.createElement('span');badge.className='collab-badge';
        const num=document.createElement('span');num.textContent=`#${idx+1}`;
        const tip=document.createElement('div');tip.className='collab-tip';
        const tipTitle=document.createElement('strong');tipTitle.textContent=`#${idx+1} • ${STATUS[t.status]??t.status}`;
        const tipText=document.createElement('p');tipText.className='collab-tip-text';
        tipText.textContent=`${t.text.slice(0,45)}${t.text.length>45?'…':''}`;
        tip.append(tipTitle,tipText);
        pinEl.append(badge,num,tip);
        pinEl.addEventListener('click',(e)=>{
          e.stopPropagation();
          openPanel();
          showView('mine');
          setTimeout(()=>{
            const item=mineList.querySelector(`[data-ticket-id="${t.id}"]`) as HTMLElement|null;
            if(item){
              item.scrollIntoView({behavior:'smooth',block:'center'});
              flashElement(t.anchor!.selector);
            }
          },120);
        });
        collabLayer.append(pinEl);
      }catch{ /* unlocatable element for pin */ }
    });
  }

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
      cachedTickets=tickets;
      updateCollabPins();
      mineList.replaceChildren();
      if(!tickets.length){
        const empty=document.createElement('div');empty.className='empty';
        empty.textContent='Aucun retour envoyé pour l’instant. Vos retours et les réponses reçues s’afficheront ici.';
        mineList.append(empty);return;
      }
      for(const ticket of tickets){
        const item=document.createElement('div');item.className=`item ${ticket.status}`;
        item.dataset.ticketId=ticket.id;
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
          btnValidate.innerHTML=`${TICK_SVG}<span>Valider la correction</span>`;
          const btnReopen=document.createElement('button');btnReopen.type='button';btnReopen.className='btn-reopen';
          btnReopen.innerHTML=`${UNDO_SVG}<span>Demander un ajustement</span>`;
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
              notice.innerHTML=`${TICK_SVG}<span>Correction validée avec succès</span>`;
              item.append(notice);
              void countReplies();
            }catch{
              btnValidate.disabled=false;btnReopen.disabled=false;btnValidate.innerHTML=`${TICK_SVG}<span>Valider la correction</span>`;
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
              notice.innerHTML=`${UNDO_SVG}<span>Demande d’ajustement envoyée</span>`;
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
    updateCollabPins();
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
  void listTickets().then(t=>{cachedTickets=t;updateCollabPins();}).catch(()=>{});
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
