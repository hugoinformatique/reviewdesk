import { normalizeDiagnostics } from '../privacy.js';

type Init = { api: string; projectId: string; token: string };
const esc = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, c => `\\${c.codePointAt(0)!.toString(16)} `);
function selectorFor(el: Element): string {
  if (el.id) return `#${esc(el.id)}`;
  const parts:string[]=[]; let node:Element|null=el;
  while(node && node!==document.body && parts.length<5){let part=node.tagName.toLowerCase();const stable=[...node.classList].filter(c=>!/active|hover|focus|selected/.test(c)).slice(0,1);if(stable.length)part+='.'+esc(stable[0]!);else if(node.parentElement){const same=[...node.parentElement.children].filter(x=>x.tagName===node!.tagName);if(same.length>1)part+=`:nth-of-type(${same.indexOf(node)+1})`;}parts.unshift(part);node=node.parentElement;}
  return parts.join('>');
}
export function init(config: Init) {
  if (!config.api || !config.projectId || !config.token || document.querySelector('reviewdesk-widget')) return;
  const host=document.createElement('reviewdesk-widget'); const root=host.attachShadow({mode:'open'}); document.documentElement.append(host);
  const style=document.createElement('style'); style.textContent=`
:host{all:initial;
  --rd-surface:#ffffff; --rd-surface-2:#f6f6f5; --rd-text:#18181b; --rd-text-2:#56565f; --rd-text-3:#8b8b94;
  --rd-border:#e6e6e2; --rd-border-2:#d6d6d1; --rd-accent:#4338ca; --rd-accent-hover:#3730a3;
  --rd-pin:#ea580c; --rd-danger:#be123c; --rd-ring:#4338ca38; --rd-shadow:0 20px 50px #18181b26,0 4px 12px #18181b14;
  font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; color:var(--rd-text);
  color-scheme:light;
}
@media(prefers-color-scheme:dark){:host{
  --rd-surface:#141417; --rd-surface-2:#1b1b1f; --rd-text:#f4f4f5; --rd-text-2:#a5a5ae; --rd-text-3:#74747e;
  --rd-border:#26262b; --rd-border-2:#35353d; --rd-accent:#6366f1; --rd-accent-hover:#818cf8;
  --rd-pin:#fb923c; --rd-danger:#fb7185; --rd-ring:#818cf855; --rd-shadow:0 20px 50px #000c,0 4px 12px #0008;
  color-scheme:dark;
}}
.fab{position:fixed;right:20px;bottom:20px;z-index:2147483646;display:inline-flex;align-items:center;gap:8px;
  border:0;border-radius:999px;background:var(--rd-accent);color:#fff;padding:12px 18px 12px 15px;
  font:600 13.5px/1 inherit;letter-spacing:-.005em;box-shadow:var(--rd-shadow);cursor:pointer;
  transition:background .14s cubic-bezier(.32,.72,0,1),transform .14s cubic-bezier(.32,.72,0,1)}
.fab:hover{background:var(--rd-accent-hover);transform:translateY(-1px)}
.fab:active{transform:translateY(0)}
.fab:has(+.panel:not(.hidden)){display:none}
.fab svg{width:16px;height:16px;flex:none}

.panel{position:fixed;right:20px;bottom:20px;z-index:2147483647;width:min(384px,calc(100vw - 24px));
  max-height:calc(100dvh - 40px);overflow:auto;background:var(--rd-surface);border:1px solid var(--rd-border);
  border-radius:16px;box-shadow:var(--rd-shadow);padding:18px;box-sizing:border-box;
  animation:rd-in .2s cubic-bezier(.32,.72,0,1)}
@keyframes rd-in{from{opacity:0;transform:translateY(8px) scale(.98)}}
.hidden{display:none}

.head{display:flex;align-items:center;gap:8px;margin-bottom:2px}
.title{font-weight:640;font-size:15px;letter-spacing:-.01em;flex:1}
.dot{width:7px;height:7px;border-radius:50%;background:var(--rd-pin);flex:none}
.hint,.privacy{font-size:12px;color:var(--rd-text-2);line-height:1.5}
.hint{margin-bottom:12px}

.target{display:block;font:11.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--rd-text-2);
  background:var(--rd-surface-2);border:1px solid var(--rd-border);padding:8px 10px;border-radius:8px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0 0 10px}

textarea{all:unset;display:block;box-sizing:border-box;width:100%;min-height:96px;border:1px solid var(--rd-border-2);
  border-radius:9px;padding:10px 11px;background:var(--rd-surface);color:var(--rd-text);
  font:13.5px/1.55 inherit;white-space:pre-wrap;transition:border-color .12s,box-shadow .12s}
textarea:focus{border-color:var(--rd-accent);box-shadow:0 0 0 3px var(--rd-ring)}
textarea::placeholder{color:var(--rd-text-3)}

.privacy{display:flex;align-items:flex-start;gap:8px;margin-top:12px;cursor:pointer}
.privacy input[type=checkbox]{margin:1px 0 0;accent-color:var(--rd-accent);width:14px;height:14px;flex:none}
.diag{background:var(--rd-surface-2);border:1px solid var(--rd-border);color:var(--rd-text-2);padding:9px 10px;
  border-radius:8px;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;
  max-height:132px;overflow:auto;margin:8px 0 0}
.file{display:block;font-size:12px;color:var(--rd-text-2);margin-top:12px}
input[type=file]{display:block;font:12px inherit;max-width:100%;margin-top:6px;color:var(--rd-text-3)}
input[type=file]::file-selector-button{font:600 12px inherit;color:var(--rd-text);background:var(--rd-surface-2);
  border:1px solid var(--rd-border-2);border-radius:7px;padding:5px 10px;margin-right:8px;cursor:pointer}

button{font:600 13px inherit;cursor:pointer;border-radius:8px;
  transition:background .12s,border-color .12s,color .12s}
.actions{display:flex;gap:8px;margin-top:14px;padding-top:14px;border-top:1px solid var(--rd-border)}
.primary{border:1px solid var(--rd-accent);background:var(--rd-accent);color:#fff;padding:9px 15px;margin-left:auto}
.primary:hover{background:var(--rd-accent-hover);border-color:var(--rd-accent-hover)}
.primary:disabled{opacity:.6;cursor:not-allowed}
.secondary{border:1px solid var(--rd-border-2);background:var(--rd-surface);color:var(--rd-text-2);padding:9px 12px}
.secondary:hover{background:var(--rd-surface-2);color:var(--rd-text)}
:host *:focus-visible{outline:2px solid var(--rd-accent);outline-offset:2px}

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

.tabs{display:flex;gap:2px;background:var(--rd-surface-2);border:1px solid var(--rd-border);
  border-radius:9px;padding:2px;margin:10px 0 12px}
.tab{flex:1;border:0;background:transparent;color:var(--rd-text-2);padding:6px 8px;border-radius:7px;
  font:600 12px inherit}
.tab[aria-pressed=true]{background:var(--rd-surface);color:var(--rd-text);box-shadow:0 1px 2px #0000001a}

.mine{display:grid;gap:8px;max-height:340px;overflow:auto}
.mine .item{border:1px solid var(--rd-border);border-radius:10px;padding:10px 11px;background:var(--rd-surface-2)}
.mine .item p{margin:0;font-size:12.5px;line-height:1.5;overflow-wrap:anywhere}
.mine .item .st{display:inline-flex;align-items:center;gap:5px;font:600 10.5px inherit;letter-spacing:.02em;
  text-transform:uppercase;color:var(--rd-text-3);margin-bottom:5px}
.mine .item .st::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.mine .item.DONE .st{color:#0a7f5a}
.mine .item.REVIEW .st{color:#7c4ddb}
.mine .item.IN_PROGRESS .st{color:#2563eb}
.mine .item.TODO .st{color:var(--rd-pin)}
.mine .item .reply{margin-top:8px;padding-top:8px;border-top:1px solid var(--rd-border);
  font-size:12px;color:var(--rd-text-2)}
.mine .item .reply strong{display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;
  color:var(--rd-text-3);margin-bottom:3px}
.mine .empty{color:var(--rd-text-3);font-size:12px;text-align:center;padding:18px 0}

.pick{position:fixed;inset:0;z-index:2147483644;cursor:crosshair;background:#4338ca0f}
.pick::after{content:"Touchez l’élément concerné";position:fixed;left:50%;top:20px;transform:translateX(-50%);
  background:var(--rd-text);color:var(--rd-surface);font:600 12.5px/1 inherit;padding:9px 14px;border-radius:999px;
  box-shadow:var(--rd-shadow);white-space:nowrap}

@media(max-width:520px){
  .fab{right:12px;bottom:12px}
  .panel{right:12px;left:12px;bottom:12px;width:auto;max-height:calc(100dvh - 24px);border-radius:14px}
  textarea{min-height:84px}
  .actions{position:sticky;bottom:-18px;background:var(--rd-surface);margin-top:14px;padding:12px 0 2px}
  .primary,.secondary{min-height:42px}
  .primary{flex:1}
}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition-duration:.01ms!important}}
`;
  const PIN_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/></svg>`;
  root.append(style); const fab=document.createElement('button');fab.className='fab';fab.type='button';fab.innerHTML=`${PIN_SVG}<span class="fab-label">Commenter</span>`;root.append(fab);
  const setFab=(label:string)=>{(fab.querySelector('.fab-label') as HTMLElement).textContent=label;};
  const panel=document.createElement('section');panel.className='panel hidden';panel.innerHTML=`<div class="head"><span class="dot"></span><div class="title">Retour visuel</div></div><div class="tabs"><button type="button" class="tab tab-compose" aria-pressed="true">Écrire</button><button type="button" class="tab tab-mine" aria-pressed="false">Mes retours</button></div><div class="view-compose"><div class="hint">Touchez l’élément concerné. Rien n’est enregistré avant l’envoi.</div><div class="target">Aucun élément sélectionné</div><textarea maxlength="4000" placeholder="Décrivez le changement attendu…"></textarea><label class="privacy"><input type="checkbox" class="diagcheck"> Joindre les diagnostics techniques minimaux</label><pre class="diag hidden"></pre><label class="file">Capture facultative (PNG, JPEG ou WebP, 5 Mo max)<input class="file-input" type="file" accept="image/png,image/jpeg,image/webp"></label><div class="actions"><button type="button" class="secondary cancel">Fermer</button><button type="button" class="secondary repick">Replacer</button><button type="button" class="primary send">Envoyer</button></div></div><div class="view-mine hidden"><div class="mine"></div></div>`;root.append(panel);
  let anchor:any=null,pin:HTMLElement|null=null;const target=panel.querySelector('.target')!, textarea=panel.querySelector('textarea')!, check=panel.querySelector('.diagcheck') as HTMLInputElement,diag=panel.querySelector('.diag')!,file=panel.querySelector('.file-input') as HTMLInputElement;
  const diagnostics=()=>normalizeDiagnostics({viewport:{width:innerWidth,height:innerHeight},dpr:devicePixelRatio,orientation:innerWidth>=innerHeight?'landscape':'portrait',locale:navigator.language,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,userAgent:navigator.userAgent,platform:navigator.platform,path:location.href,errors:anchor?[]:[{category:'widget',code:'ANCHOR_MISSING',count:1}]});
  check.addEventListener('change',()=>{diag.classList.toggle('hidden',!check.checked);diag.textContent=check.checked?JSON.stringify(diagnostics(),null,2):'';});
  function pick(){panel.classList.add('hidden');const overlay=document.createElement('div');overlay.className='pick';root.append(overlay);const done=(ev:PointerEvent)=>{ev.preventDefault();overlay.remove();const el=document.elementFromPoint(ev.clientX,ev.clientY);if(!el||el===host){panel.classList.remove('hidden');return;}const r=el.getBoundingClientRect();anchor={selector:selectorFor(el),relative:{x:Math.max(0,Math.min(1,(ev.clientX-r.left)/Math.max(1,r.width))),y:Math.max(0,Math.min(1,(ev.clientY-r.top)/Math.max(1,r.height)))},viewport:{width:innerWidth,height:innerHeight}};pin?.remove();pin=document.createElement('div');pin.className='pin';pin.textContent='1';pin.style.left=ev.clientX+'px';pin.style.top=ev.clientY+'px';root.append(pin);target.textContent=anchor.selector;panel.classList.remove('hidden');if(check.checked)diag.textContent=JSON.stringify(diagnostics(),null,2);};overlay.addEventListener('pointerup',done,{once:true});}
  fab.onclick=()=>{panel.classList.remove('hidden');if(!anchor)pick();};panel.querySelector('.repick')!.addEventListener('click',pick);panel.querySelector('.cancel')!.addEventListener('click',()=>panel.classList.add('hidden'));
  panel.querySelector('.send')!.addEventListener('click',async()=>{const send=panel.querySelector('.send') as HTMLButtonElement;if(!anchor||textarea.value.trim().length<2){target.textContent='Sélectionnez un élément et ajoutez un commentaire.';return;}send.disabled=true;send.textContent='Envoi…';try{let screenshotId:string|undefined;if(file.files?.[0]){const form=new FormData();form.append('file',file.files[0]);const up=await fetch(`${config.api}/api/uploads?projectId=${encodeURIComponent(config.projectId)}`,{method:'POST',headers:{Authorization:`Bearer ${config.token}`},body:form});if(!up.ok)throw new Error('UPLOAD_FAILED');screenshotId=(await up.json()).id;}const response=await fetch(`${config.api}/api/feedback?projectId=${encodeURIComponent(config.projectId)}`,{method:'POST',headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json'},body:JSON.stringify({projectId:config.projectId,text:textarea.value,pageUrl:location.href,anchor,diagnostics:check.checked?diagnostics():{},screenshotId})});if(!response.ok)throw new Error('SEND_FAILED');textarea.value='';file.value='';panel.classList.add('hidden');pin?.remove();pin=null;anchor=null;setFab('Envoyé');setTimeout(()=>setFab('Commenter'),1800);}catch{target.textContent='Envoi impossible. Vérifiez le lien ou réessayez.';}finally{send.disabled=false;send.textContent='Envoyer';}});
  // ------------------------------------------------------------------- tabs

  const STATUS:Record<string,string>={TODO:'À traiter',IN_PROGRESS:'En cours',REVIEW:'À valider',DONE:'Traité'};
  const composeView=panel.querySelector('.view-compose') as HTMLElement;
  const mineView=panel.querySelector('.view-mine') as HTMLElement;
  const mineList=panel.querySelector('.mine') as HTMLElement;
  const tabCompose=panel.querySelector('.tab-compose') as HTMLButtonElement;
  const tabMine=panel.querySelector('.tab-mine') as HTMLButtonElement;

  function showTab(which:'compose'|'mine'){
    const mine=which==='mine';
    composeView.classList.toggle('hidden',mine);
    mineView.classList.toggle('hidden',!mine);
    tabCompose.setAttribute('aria-pressed',String(!mine));
    tabMine.setAttribute('aria-pressed',String(mine));
    if(mine)void loadMine();
  }

  /** Reads back what this link has already filed, plus any reply from the admin. */
  async function loadMine(){
    mineList.replaceChildren();
    const loading=document.createElement('div');loading.className='empty';loading.textContent='Chargement…';
    mineList.append(loading);
    try{
      const response=await fetch(`${config.api}/api/feedback?projectId=${encodeURIComponent(config.projectId)}`,
        {headers:{Authorization:`Bearer ${config.token}`}});
      if(!response.ok)throw new Error('LIST_FAILED');
      const {tickets}=await response.json() as {tickets:{id:string;text:string;status:string;replyText:string}[]};
      mineList.replaceChildren();
      if(!tickets.length){
        const empty=document.createElement('div');empty.className='empty';
        empty.textContent='Aucun retour envoyé pour l’instant.';mineList.append(empty);return;
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
          const label=document.createElement('strong');label.textContent='Réponse';
          const body=document.createElement('span');body.textContent=ticket.replyText;
          reply.append(label,body);item.append(reply);
        }
        mineList.append(item);
      }
    }catch{
      mineList.replaceChildren();
      const failed=document.createElement('div');failed.className='empty';
      failed.textContent='Liste indisponible. Vérifiez le lien.';mineList.append(failed);
    }
  }

  tabCompose.addEventListener('click',()=>showTab('compose'));
  tabMine.addEventListener('click',()=>showTab('mine'));

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
