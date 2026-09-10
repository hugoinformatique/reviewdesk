import { normalizeDiagnostics } from '../privacy.js';

type Init = {
  api: string;
  projectId: string;
  token: string;
  /** Wording of the launcher, for sites that already say "avis" or "feedback". */
  label?: string;
  position?: 'bottom-right' | 'bottom-left';
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

export function init(config: Init) {
  if (!config.api || !config.projectId || !config.token || document.querySelector('reviewdesk-widget')) return;
  const host=document.createElement('reviewdesk-widget'); const root=host.attachShadow({mode:'open'}); document.documentElement.append(host);
  if (config.position === 'bottom-left') host.setAttribute('data-side', 'left');
  const style=document.createElement('style'); style.textContent=`
:host{all:initial;
  --rd-surface:#ffffff; --rd-surface-2:#f7f7f6; --rd-surface-3:#efefed; --rd-text:#18181b; --rd-text-2:#56565f; --rd-text-3:#8b8b94;
  --rd-border:#e6e6e2; --rd-border-2:#d6d6d1; --rd-accent:#4338ca; --rd-accent-hover:#3730a3; --rd-accent-soft:#4338ca14;
  --rd-pin:#ea580c; --rd-danger:#be123c; --rd-ok:#0a7f5a; --rd-ring:#4338ca38;
  --rd-shadow:0 24px 60px #18181b2e,0 4px 14px #18181b17;
  --rd-edge:20px;
  font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; color:var(--rd-text);
  color-scheme:light;
}
@media(prefers-color-scheme:dark){:host{
  --rd-surface:#141417; --rd-surface-2:#1b1b1f; --rd-surface-3:#232329; --rd-text:#f4f4f5; --rd-text-2:#a5a5ae; --rd-text-3:#74747e;
  --rd-border:#26262b; --rd-border-2:#35353d; --rd-accent:#6366f1; --rd-accent-hover:#818cf8; --rd-accent-soft:#6366f11f;
  --rd-pin:#fb923c; --rd-danger:#fb7185; --rd-ok:#34d399; --rd-ring:#818cf855; --rd-shadow:0 24px 60px #000d,0 4px 14px #0009;
  color-scheme:dark;
}}
:host([data-side=left]) .fab,:host([data-side=left]) .panel{right:auto;left:var(--rd-edge)}

/* ------------------------------------------------------------------ launcher */
.fab{position:fixed;right:var(--rd-edge);bottom:var(--rd-edge);z-index:2147483646;display:inline-flex;align-items:center;gap:9px;
  border:0;border-radius:999px;background:var(--rd-accent);color:#fff;padding:13px 20px 13px 16px;
  font:600 14px/1 inherit;letter-spacing:-.006em;box-shadow:var(--rd-shadow);cursor:pointer;
  transition:background .16s cubic-bezier(.32,.72,0,1),transform .16s cubic-bezier(.32,.72,0,1),box-shadow .16s}
.fab:hover{background:var(--rd-accent-hover);transform:translateY(-1.5px)}
.fab:active{transform:translateY(0) scale(.985)}
.fab:has(+.panel:not(.hidden)),.fab.away{display:none}
.fab svg{width:17px;height:17px;flex:none}
.fab .badge{min-width:18px;height:18px;border-radius:999px;background:#fff;color:var(--rd-accent);
  font:700 11px/18px inherit;text-align:center;padding:0 5px;box-sizing:border-box}
.fab .badge.hidden{display:none}

/* --------------------------------------------------------------------- panel */
.panel{position:fixed;right:var(--rd-edge);bottom:var(--rd-edge);z-index:2147483647;width:min(392px,calc(100vw - 24px));
  max-height:calc(100dvh - 40px);display:flex;flex-direction:column;overflow:hidden;background:var(--rd-surface);
  border:1px solid var(--rd-border);border-radius:18px;box-shadow:var(--rd-shadow);box-sizing:border-box;
  animation:rd-in .22s cubic-bezier(.32,.72,0,1)}
@keyframes rd-in{from{opacity:0;transform:translateY(10px) scale(.985)}}
.hidden{display:none!important}
.body{overflow:auto;padding:0 18px 18px}

.head{display:flex;align-items:center;gap:10px;padding:16px 14px 12px 18px}
.head .mark{width:26px;height:26px;border-radius:8px;background:var(--rd-accent-soft);color:var(--rd-accent);
  display:grid;place-items:center;flex:none}
.head .mark svg{width:15px;height:15px}
.title{font-weight:640;font-size:15px;letter-spacing:-.012em;line-height:1.2}
.sub{font-size:11.5px;color:var(--rd-text-3);line-height:1.3;margin-top:1px}
.head .grow{flex:1;min-width:0}
.close{flex:none;border:0;background:transparent;color:var(--rd-text-3);width:30px;height:30px;border-radius:8px;
  font:400 19px/1 inherit;display:grid;place-items:center}
.close:hover{background:var(--rd-surface-2);color:var(--rd-text)}

.tabs{display:flex;gap:2px;background:var(--rd-surface-2);border:1px solid var(--rd-border);
  border-radius:10px;padding:3px;margin:0 18px 14px}
.tab{flex:1;border:0;background:transparent;color:var(--rd-text-2);padding:7px 8px;border-radius:7px;
  font:600 12.5px inherit;display:inline-flex;align-items:center;justify-content:center;gap:6px}
.tab[aria-pressed=true]{background:var(--rd-surface);color:var(--rd-text);box-shadow:0 1px 2px #0000001f}
.tab .badge{min-width:17px;height:17px;border-radius:999px;background:var(--rd-accent);color:#fff;
  font:700 10.5px/17px inherit;text-align:center;padding:0 4px;box-sizing:border-box}
.tab .badge.hidden{display:none}

/* --------------------------------------------------------------------- steps */
.steps{list-style:none;margin:0;padding:0;display:grid;gap:14px}
.step{display:grid;grid-template-columns:22px minmax(0,1fr);gap:10px;align-items:start}
.num{width:22px;height:22px;border-radius:999px;background:var(--rd-surface-3);color:var(--rd-text-2);
  font:700 11px/22px inherit;text-align:center;margin-top:1px}
.step.done .num{background:var(--rd-accent);color:#fff}
.step-label{font:600 12.5px inherit;letter-spacing:-.006em;margin-bottom:6px;display:block}
.step-label .opt{font-weight:500;color:var(--rd-text-3)}

.target{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;text-align:left;
  border:1.5px dashed var(--rd-border-2);background:var(--rd-surface-2);color:var(--rd-text-2);
  border-radius:11px;padding:11px 12px;font:500 13px inherit;cursor:pointer;
  transition:border-color .14s,background .14s,color .14s}
.target:hover{border-color:var(--rd-accent);color:var(--rd-text);background:var(--rd-accent-soft)}
.target svg{width:16px;height:16px;flex:none;color:var(--rd-accent)}
.target .lbl{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.target .act{flex:none;font:600 11.5px inherit;color:var(--rd-accent)}
.target.set{border-style:solid;border-color:var(--rd-border);background:var(--rd-surface);color:var(--rd-text);font-weight:600}
.target.set svg{color:var(--rd-pin)}

textarea{all:unset;display:block;box-sizing:border-box;width:100%;min-height:98px;border:1px solid var(--rd-border-2);
  border-radius:11px;padding:11px 12px;background:var(--rd-surface);color:var(--rd-text);
  font:13.5px/1.55 inherit;white-space:pre-wrap;transition:border-color .12s,box-shadow .12s}
textarea:focus{border-color:var(--rd-accent);box-shadow:0 0 0 3px var(--rd-ring)}
textarea::placeholder{color:var(--rd-text-3)}

/* -------------------------------------------------------------------- extras */
.extras{margin-top:14px;border-top:1px solid var(--rd-border);padding-top:12px;display:grid;gap:10px}
.attach{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--rd-border-2);background:var(--rd-surface);
  color:var(--rd-text-2);border-radius:9px;padding:8px 12px;font:600 12.5px inherit;cursor:pointer;justify-self:start}
.attach:hover{background:var(--rd-surface-2);color:var(--rd-text)}
.attach svg{width:14px;height:14px}
.attach-hint{font-size:11.5px;color:var(--rd-text-3);margin-top:-4px}
input[type=file]{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
.shot{display:flex;align-items:center;gap:10px;border:1px solid var(--rd-border);background:var(--rd-surface-2);
  border-radius:10px;padding:8px 10px}
.shot img{width:38px;height:38px;object-fit:cover;border-radius:7px;flex:none;background:var(--rd-surface-3)}
.shot .name{flex:1;min-width:0;font-size:12px;color:var(--rd-text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.shot .drop{flex:none;border:0;background:transparent;color:var(--rd-text-3);font:600 12px inherit;padding:4px 6px;border-radius:6px}
.shot .drop:hover{color:var(--rd-danger);background:var(--rd-surface-3)}

.privacy{display:flex;align-items:flex-start;gap:9px;font-size:12.5px;color:var(--rd-text-2);line-height:1.45;cursor:pointer}
.privacy input[type=checkbox]{margin:1px 0 0;accent-color:var(--rd-accent);width:15px;height:15px;flex:none}
.privacy .why{display:block;font-size:11.5px;color:var(--rd-text-3);margin-top:2px}
.seediag{border:0;background:transparent;color:var(--rd-accent);font:600 11.5px inherit;padding:0;justify-self:start;
  text-decoration:underline;text-underline-offset:2px}
.diag{background:var(--rd-surface-2);border:1px solid var(--rd-border);color:var(--rd-text-2);padding:9px 10px;
  border-radius:9px;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;
  max-height:132px;overflow:auto;margin:0}

/* ------------------------------------------------------------------- actions */
button{font:600 13px inherit;cursor:pointer;border-radius:9px;
  transition:background .12s,border-color .12s,color .12s,transform .12s}
.actions{display:flex;gap:8px;align-items:center;margin-top:14px;padding-top:14px;border-top:1px solid var(--rd-border)}
.primary{border:1px solid var(--rd-accent);background:var(--rd-accent);color:#fff;padding:10px 16px;margin-left:auto}
.primary:hover{background:var(--rd-accent-hover);border-color:var(--rd-accent-hover)}
.primary:active{transform:scale(.99)}
.primary:disabled{opacity:.55;cursor:not-allowed}
.secondary{border:1px solid var(--rd-border-2);background:var(--rd-surface);color:var(--rd-text-2);padding:10px 13px}
.secondary:hover{background:var(--rd-surface-2);color:var(--rd-text)}
.kbd{font-size:11px;color:var(--rd-text-3);margin-right:auto}
:host *:focus-visible{outline:2px solid var(--rd-accent);outline-offset:2px}

.msg{margin-top:12px;border-radius:9px;padding:9px 11px;font-size:12.5px;line-height:1.45;
  background:#be123c14;color:var(--rd-danger);border:1px solid #be123c33}

/* --------------------------------------------------------------------- sent */
.sent{text-align:center;padding:22px 6px 6px}
.sent .check{width:46px;height:46px;border-radius:999px;background:var(--rd-accent-soft);color:var(--rd-ok);
  display:grid;place-items:center;margin:0 auto 14px;animation:rd-pop .32s cubic-bezier(.32,.72,0,1)}
.sent .check svg{width:24px;height:24px}
@keyframes rd-pop{from{transform:scale(.6);opacity:0}}
.sent h2{margin:0 0 5px;font:640 15.5px inherit;letter-spacing:-.012em}
.sent p{margin:0;font-size:12.5px;color:var(--rd-text-2);line-height:1.5}
.sent .actions{border-top:0;justify-content:center;margin-top:18px;padding-top:0}
.sent .primary{margin-left:0}

/* ----------------------------------------------------------------- my replies */
.mine{display:grid;gap:9px;max-height:340px;overflow:auto}
.mine .item{border:1px solid var(--rd-border);border-radius:11px;padding:11px 12px;background:var(--rd-surface-2)}
.mine .item p{margin:0;font-size:12.5px;line-height:1.5;overflow-wrap:anywhere}
.mine .item .st{display:inline-flex;align-items:center;gap:5px;font:600 10.5px inherit;letter-spacing:.04em;
  text-transform:uppercase;color:var(--rd-text-3);margin-bottom:5px}
.mine .item .st::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.mine .item.DONE .st{color:var(--rd-ok)}
.mine .item.REVIEW .st{color:#7c4ddb}
.mine .item.IN_PROGRESS .st{color:#2563eb}
.mine .item.TODO .st{color:var(--rd-pin)}
.mine .item .reply{margin-top:9px;padding:9px 10px;border-radius:8px;background:var(--rd-surface);
  border:1px solid var(--rd-border);font-size:12px;color:var(--rd-text-2);line-height:1.5}
.mine .item .reply strong{display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;
  color:var(--rd-accent);margin-bottom:3px}
.mine .empty{color:var(--rd-text-3);font-size:12.5px;text-align:center;padding:26px 12px;line-height:1.5}

/* ---------------------------------------------------------------------- pins */
.pin{position:fixed;z-index:2147483645;width:26px;height:26px;border:2.5px solid #fff;border-radius:50%;
  background:var(--rd-pin);color:#fff;display:grid;place-items:center;transform:translate(-50%,-50%);
  box-shadow:0 3px 12px #0000004d;font:800 12px/1 inherit;pointer-events:none}
.pin::before{content:"";position:absolute;inset:-6px;border-radius:50%;
  border:2px solid var(--rd-pin);opacity:.35;animation:rd-ping 2.4s cubic-bezier(.32,.72,0,1) infinite}
@keyframes rd-ping{0%{transform:scale(.8);opacity:.45}70%,100%{transform:scale(1.35);opacity:0}}
/* The pin replayed from an admin deep link is deliberately a different colour
   from the one being placed, so the two are never confused. */
.pin.replay{background:var(--rd-accent)}
.pin.replay::before{border-color:var(--rd-accent)}
.pin.missing{background:var(--rd-danger)}
.pin.missing::before{display:none}

/* -------------------------------------------------------------- pick overlay */
.pick{position:fixed;inset:0;z-index:2147483644;cursor:crosshair;background:#4338ca0f}
/* The highlight tracks the element under the pointer so the reviewer sees what
   they are about to designate before they commit to it. */
.hl{position:fixed;z-index:2147483643;pointer-events:none;border:2px solid var(--rd-accent);border-radius:6px;
  background:var(--rd-accent-soft);box-shadow:0 0 0 9999px #18181b1f;transition:all .09s cubic-bezier(.32,.72,0,1)}
.hl.hidden{display:none}
/* pointer-events:none so the bar never shields whatever sits under it — a
   header or logo near the top of the page must stay pointable. Only the cancel
   button takes clicks back. */
.pickbar{position:fixed;left:50%;top:20px;transform:translateX(-50%);display:flex;align-items:center;gap:12px;
  max-width:min(560px,calc(100vw - 32px));background:var(--rd-text);color:var(--rd-surface);font:600 12.5px/1.3 inherit;
  padding:9px 9px 9px 16px;border-radius:999px;box-shadow:var(--rd-shadow);pointer-events:none;
  animation:rd-in .18s cubic-bezier(.32,.72,0,1)}
.pickbar>span:first-child{flex:none;white-space:nowrap}
.pickbar .what{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.72;font-weight:500}
.pickbar .what:empty{display:none}
.pickcancel{pointer-events:auto;cursor:pointer;border:0;background:#ffffff26;color:inherit;padding:7px 12px;
  border-radius:999px;font:600 12px inherit;flex:none}
.pickcancel:hover{background:#ffffff40}

@media(max-width:520px){
  :host{--rd-edge:12px}
  .panel{right:12px;left:12px;bottom:12px;width:auto;max-height:calc(100dvh - 24px);border-radius:16px}
  .fab{padding:13px 18px 13px 15px}
  textarea{min-height:88px}
  .primary,.secondary{min-height:44px}
  .primary{flex:1}
  .kbd{display:none}
  .pickbar{left:12px;right:12px;transform:none;max-width:none}
}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition-duration:.01ms!important}}
`;
  if (config.accent) {
    host.style.setProperty('--rd-accent', config.accent);
    host.style.setProperty('--rd-accent-hover', config.accent);
  }
  const PIN_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/></svg>`;
  const TARGET_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="7.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>`;
  const IMAGE_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m4 17 5-4.5 4.5 4 3-2.5L20 18"/></svg>`;
  const CHECK_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`;

  root.append(style);
  const launcherLabel = config.label?.trim() || 'Donner mon avis';
  const fab=document.createElement('button');fab.className='fab';fab.type='button';
  fab.innerHTML=`${PIN_SVG}<span class="fab-label"></span><span class="badge hidden"></span>`;
  (fab.querySelector('.fab-label') as HTMLElement).textContent=launcherLabel;
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
  <button type="button" class="tab tab-compose" aria-pressed="true">Nouveau retour</button>
  <button type="button" class="tab tab-mine" aria-pressed="false">Mes retours<span class="badge hidden"></span></button>
</div>
<div class="body">
  <div class="view-compose">
    <ol class="steps">
      <li class="step step-target">
        <span class="num">1</span>
        <div>
          <span class="step-label">Montrez l’endroit concerné</span>
          <button type="button" class="target">${TARGET_SVG}<span class="lbl">Cliquez ici, puis l’endroit sur la page</span><span class="act"></span></button>
        </div>
      </li>
      <li class="step step-text">
        <span class="num">2</span>
        <div>
          <span class="step-label">Dites ce qui ne va pas</span>
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
  const targetLabel=panel.querySelector('.target .lbl') as HTMLElement;
  const targetAct=panel.querySelector('.target .act') as HTMLElement;
  const stepTarget=panel.querySelector('.step-target') as HTMLElement;
  const textarea=panel.querySelector('textarea') as HTMLTextAreaElement;
  const check=panel.querySelector('.diagcheck') as HTMLInputElement;
  const seediag=panel.querySelector('.seediag') as HTMLButtonElement;
  const diag=panel.querySelector('.diag') as HTMLElement;
  const file=panel.querySelector('.file-input') as HTMLInputElement;
  const shot=panel.querySelector('.shot') as HTMLElement;
  const shotImg=panel.querySelector('.shot img') as HTMLImageElement;
  const shotName=panel.querySelector('.shot .name') as HTMLElement;
  const msg=panel.querySelector('.msg') as HTMLElement;
  const sendBtn=panel.querySelector('.send') as HTMLButtonElement;

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
    stepTarget.classList.toggle('done',set);
    targetLabel.textContent=set?anchor.label:'Cliquez ici, puis l’endroit sur la page';
    targetBtn.title=set?anchor.selector:'';
    targetAct.textContent=set?'Changer':'';
  }

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
      pin.style.left=ev.clientX+'px';pin.style.top=ev.clientY+'px';root.append(pin);
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

  function showView(which:'compose'|'sent'|'mine'){
    composeView.classList.toggle('hidden',which!=='compose');
    sentView.classList.toggle('hidden',which!=='sent');
    mineView.classList.toggle('hidden',which!=='mine');
    tabCompose.setAttribute('aria-pressed',String(which!=='mine'));
    tabMine.setAttribute('aria-pressed',String(which==='mine'));
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
  addEventListener('keydown',(ev)=>{
    if(ev.key==='Escape'&&!panel.classList.contains('hidden')&&!root.querySelector('.pick'))closePanel();
  });
  textarea.addEventListener('keydown',(ev)=>{
    if(ev.key==='Enter'&&(ev.metaKey||ev.ctrlKey)){ev.preventDefault();sendBtn.click();}
  });
  textarea.addEventListener('input',()=>{
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
      textarea.value='';setShot(null);
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
  type Ticket={id:string;text:string;status:string;replyText:string};

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
        const status=document.createElement('div');status.className='st';
        status.textContent=STATUS[ticket.status]??ticket.status;
        const text=document.createElement('p');
        // textContent throughout: this is the reviewer's own text coming back.
        text.textContent=ticket.text;
        item.append(status,text);
        if(ticket.replyText){
          const reply=document.createElement('div');reply.className='reply';
          const label=document.createElement('strong');label.textContent='Réponse de l’équipe';
          const body=document.createElement('span');body.textContent=ticket.replyText;
          reply.append(label,body);item.append(reply);
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
    position: script.dataset.position === 'bottom-left' ? 'bottom-left' : 'bottom-right',
    accent: script.dataset.accent,
  });
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
}
