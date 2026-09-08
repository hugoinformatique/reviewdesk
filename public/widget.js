"use strict";
var ReviewDesk = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/widget/index.ts
  var index_exports = {};
  __export(index_exports, {
    init: () => init
  });

  // src/privacy.ts
  var bounded = (value, max = 80) => typeof value === "string" ? value.slice(0, max) : void 0;
  function cleanUrl(raw) {
    try {
      const url = new URL(raw);
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/$/, raw.includes(url.pathname + "/") ? "/" : "");
    } catch {
      return "";
    }
  }
  function coarseBrowser(ua) {
    if (/Firefox\//.test(ua)) return "Firefox";
    if (/Edg\//.test(ua)) return "Edge";
    if (/Chrome\//.test(ua)) return "Chrome";
    if (/Safari\//.test(ua)) return "Safari";
    return "Unknown";
  }
  function coarseOs(platform) {
    if (/Mac/i.test(platform)) return "macOS";
    if (/Win/i.test(platform)) return "Windows";
    if (/Linux/i.test(platform)) return "Linux";
    if (/iPhone|iPad/i.test(platform)) return "iOS";
    return "Unknown";
  }
  function normalizeDiagnostics(input) {
    const out = {};
    const vp = input.viewport;
    if (vp && Number.isFinite(vp.width) && Number.isFinite(vp.height)) out.viewport = { width: Math.round(Number(vp.width)), height: Math.round(Number(vp.height)) };
    if (Number.isFinite(input.dpr)) out.dpr = Math.min(4, Math.max(1, Number(input.dpr)));
    if (input.orientation === "portrait" || input.orientation === "landscape") out.orientation = input.orientation;
    out.locale = bounded(input.locale, 20);
    out.timezone = bounded(input.timezone, 50);
    out.browser = coarseBrowser(String(input.userAgent ?? ""));
    out.os = coarseOs(String(input.platform ?? ""));
    if (typeof input.path === "string") out.path = cleanUrl(input.path);
    if (Array.isArray(input.errors)) out.errors = input.errors.slice(0, 10).flatMap((raw) => {
      const e = raw;
      const category = bounded(e.category, 24), code = bounded(e.code, 32);
      if (!category || !code || !Number.isFinite(e.count)) return [];
      const rawMessage = bounded(e.message, 120);
      const message = rawMessage && /token|bearer|password|secret|cookie|[A-Za-z0-9_-]{20,}/i.test(rawMessage) ? "[redacted]" : rawMessage;
      return [{ category, code, count: Math.min(100, Math.max(1, Math.floor(Number(e.count)))), ...message ? { message } : {} }];
    });
    return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== void 0));
  }

  // src/widget/index.ts
  var esc = (s) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c.codePointAt(0).toString(16)} `);
  function selectorFor(el) {
    if (el.id) return `#${esc(el.id)}`;
    const parts = [];
    let node = el;
    while (node && node !== document.body && parts.length < 5) {
      let part = node.tagName.toLowerCase();
      const stable = [...node.classList].filter((c) => !/active|hover|focus|selected/.test(c)).slice(0, 1);
      if (stable.length) part += "." + esc(stable[0]);
      else if (node.parentElement) {
        const same = [...node.parentElement.children].filter((x) => x.tagName === node.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(">");
  }
  function init(config) {
    if (!config.api || !config.projectId || !config.token || document.querySelector("reviewdesk-widget")) return;
    const host = document.createElement("reviewdesk-widget");
    const root = host.attachShadow({ mode: "open" });
    document.documentElement.append(host);
    const style = document.createElement("style");
    style.textContent = `:host{all:initial;font-family:Inter,ui-sans-serif,system-ui;color:#17221b}.fab{position:fixed;right:20px;bottom:20px;z-index:2147483646;border:0;border-radius:999px;background:#153f2e;color:white;padding:13px 18px;font-weight:700;box-shadow:0 8px 28px #001a0d55;cursor:pointer}.fab:has(+.panel:not(.hidden)){display:none}.panel{position:fixed;right:20px;bottom:76px;z-index:2147483647;width:min(380px,calc(100vw - 24px));max-height:calc(100vh - 100px);overflow:auto;background:#fbfdf9;border:1px solid #bfcac2;border-radius:14px;box-shadow:0 18px 50px #001a0d44;padding:18px;box-sizing:border-box}.hidden{display:none}.pin{position:fixed;z-index:2147483645;width:28px;height:28px;border:3px solid white;border-radius:50%;background:#ef6a4b;color:white;display:grid;place-items:center;transform:translate(-50%,-50%);box-shadow:0 2px 10px #0005;font-weight:800}.pick{position:fixed;inset:0;z-index:2147483644;cursor:crosshair;background:#153f2e08}.title{font-weight:800;font-size:17px;margin-bottom:4px}.hint,.privacy{font-size:12px;color:#526059;line-height:1.4}.target{font:12px ui-monospace,monospace;background:#eef3ef;padding:7px;border-radius:7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:10px 0}textarea{all:unset;display:block;box-sizing:border-box;width:100%;min-height:100px;border:1px solid #aebbb1;border-radius:9px;padding:10px;background:white;font:14px system-ui;white-space:pre-wrap}button{font:600 13px system-ui;cursor:pointer}.actions{display:flex;gap:8px;margin-top:12px}.primary{border:0;border-radius:8px;background:#153f2e;color:white;padding:10px 14px}.secondary{border:1px solid #aebbb1;border-radius:8px;background:white;padding:9px 12px}.diag{background:#eef3ef;padding:8px;border-radius:7px;font:11px ui-monospace,monospace;white-space:pre-wrap;max-height:120px;overflow:auto;margin-top:7px}input[type=file]{font:12px system-ui;max-width:100%;margin-top:8px}@media(max-width:520px){.fab{right:12px;bottom:12px}.panel{right:12px;bottom:12px;max-height:calc(100vh - 24px)}textarea{min-height:86px}.actions{position:sticky;bottom:-18px;background:#fbfdf9;padding:10px 0 0}.primary{min-height:44px;flex:1}}`;
    root.append(style);
    const fab = document.createElement("button");
    fab.className = "fab";
    fab.textContent = "\u2726 Commenter";
    root.append(fab);
    const panel = document.createElement("section");
    panel.className = "panel hidden";
    panel.innerHTML = `<div class="title">Retour visuel</div><div class="hint">Touchez l\u2019\xE9l\xE9ment concern\xE9. Rien n\u2019est enregistr\xE9 avant l\u2019envoi.</div><div class="target">Aucun \xE9l\xE9ment s\xE9lectionn\xE9</div><textarea maxlength="4000" placeholder="D\xE9crivez le changement attendu\u2026"></textarea><label class="privacy"><input type="checkbox" class="diagcheck"> Joindre les diagnostics techniques minimaux</label><pre class="diag hidden"></pre><label class="privacy">Capture facultative (PNG, JPEG ou WebP, 5 Mo max)<input class="file" type="file" accept="image/png,image/jpeg,image/webp"></label><div class="actions"><button class="secondary cancel">Fermer</button><button class="secondary repick">Replacer</button><button class="primary send">Envoyer</button></div>`;
    root.append(panel);
    let anchor = null, pin = null;
    const target = panel.querySelector(".target"), textarea = panel.querySelector("textarea"), check = panel.querySelector(".diagcheck"), diag = panel.querySelector(".diag"), file = panel.querySelector(".file");
    const diagnostics = () => normalizeDiagnostics({ viewport: { width: innerWidth, height: innerHeight }, dpr: devicePixelRatio, orientation: innerWidth >= innerHeight ? "landscape" : "portrait", locale: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, userAgent: navigator.userAgent, platform: navigator.platform, path: location.href, errors: anchor ? [] : [{ category: "widget", code: "ANCHOR_MISSING", count: 1 }] });
    check.addEventListener("change", () => {
      diag.classList.toggle("hidden", !check.checked);
      diag.textContent = check.checked ? JSON.stringify(diagnostics(), null, 2) : "";
    });
    function pick() {
      panel.classList.add("hidden");
      const overlay = document.createElement("div");
      overlay.className = "pick";
      root.append(overlay);
      const done = (ev) => {
        ev.preventDefault();
        overlay.remove();
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        if (!el || el === host) {
          panel.classList.remove("hidden");
          return;
        }
        const r = el.getBoundingClientRect();
        anchor = { selector: selectorFor(el), relative: { x: Math.max(0, Math.min(1, (ev.clientX - r.left) / Math.max(1, r.width))), y: Math.max(0, Math.min(1, (ev.clientY - r.top) / Math.max(1, r.height))) }, viewport: { width: innerWidth, height: innerHeight } };
        pin?.remove();
        pin = document.createElement("div");
        pin.className = "pin";
        pin.textContent = "1";
        pin.style.left = ev.clientX + "px";
        pin.style.top = ev.clientY + "px";
        root.append(pin);
        target.textContent = anchor.selector;
        panel.classList.remove("hidden");
        if (check.checked) diag.textContent = JSON.stringify(diagnostics(), null, 2);
      };
      overlay.addEventListener("pointerup", done, { once: true });
    }
    fab.onclick = () => {
      panel.classList.remove("hidden");
      if (!anchor) pick();
    };
    panel.querySelector(".repick").addEventListener("click", pick);
    panel.querySelector(".cancel").addEventListener("click", () => panel.classList.add("hidden"));
    panel.querySelector(".send").addEventListener("click", async () => {
      const send = panel.querySelector(".send");
      if (!anchor || textarea.value.trim().length < 2) {
        target.textContent = "S\xE9lectionnez un \xE9l\xE9ment et ajoutez un commentaire.";
        return;
      }
      send.disabled = true;
      send.textContent = "Envoi\u2026";
      try {
        let screenshotId;
        if (file.files?.[0]) {
          const form = new FormData();
          form.append("file", file.files[0]);
          const up = await fetch(`${config.api}/api/uploads?projectId=${encodeURIComponent(config.projectId)}`, { method: "POST", headers: { Authorization: `Bearer ${config.token}` }, body: form });
          if (!up.ok) throw new Error("UPLOAD_FAILED");
          screenshotId = (await up.json()).id;
        }
        const response = await fetch(`${config.api}/api/feedback`, { method: "POST", headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ projectId: config.projectId, text: textarea.value, pageUrl: location.href, anchor, diagnostics: check.checked ? diagnostics() : {}, screenshotId }) });
        if (!response.ok) throw new Error("SEND_FAILED");
        textarea.value = "";
        file.value = "";
        panel.classList.add("hidden");
        pin?.remove();
        pin = null;
        anchor = null;
        fab.textContent = "\u2713 Envoy\xE9";
        setTimeout(() => fab.textContent = "\u2726 Commenter", 1800);
      } catch {
        target.textContent = "Envoi impossible. V\xE9rifiez le lien ou r\xE9essayez.";
      } finally {
        send.disabled = false;
        send.textContent = "Envoyer";
      }
    });
    const reposition = () => {
      if (!anchor || !pin) return;
      let el = null;
      try {
        el = document.querySelector(anchor.selector);
      } catch {
        el = null;
      }
      if (!el) {
        pin.textContent = "!";
        pin.title = "\xC9l\xE9ment d\u2019origine introuvable";
        return;
      }
      const r = el.getBoundingClientRect();
      pin.style.left = r.left + r.width * anchor.relative.x + "px";
      pin.style.top = r.top + r.height * anchor.relative.y + "px";
    };
    addEventListener("resize", reposition, { passive: true });
    addEventListener("scroll", reposition, { passive: true, capture: true });
  }
  return __toCommonJS(index_exports);
})();
