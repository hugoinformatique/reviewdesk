"use strict";
(() => {
  // src/admin/app.ts
  var $ = (s) => document.querySelector(s);
  var projects = [];
  var tickets = [];
  var selectedProject = "";
  var selectedTicket = "";
  var labels = { TODO: "\xC0 traiter", IN_PROGRESS: "En cours", REVIEW: "\xC0 valider", DONE: "Trait\xE9" };
  async function api(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { ...options.body instanceof FormData ? {} : { "Content-Type": "application/json" }, ...options.headers || {} } });
    if (response.status === 401) {
      showLogin();
      throw new Error("UNAUTHORIZED");
    }
    if (!response.ok) throw new Error(await response.text());
    return response.status === 204 ? null : response.json();
  }
  function showLogin() {
    $("#login").hidden = false;
    $("#app").hidden = true;
  }
  function showApp() {
    $("#login").hidden = true;
    $("#app").hidden = false;
  }
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify(Object.fromEntries(f)) });
      await load();
    } catch {
      $("output").textContent = "Identifiants invalides.";
    }
  });
  async function load() {
    projects = await api("/api/projects");
    showApp();
    renderProjects();
    await loadTickets();
  }
  function renderProjects() {
    const nav = $("#projects");
    nav.replaceChildren();
    const all = document.createElement("button");
    all.className = "project " + (!selectedProject ? "active" : "");
    all.textContent = "Tous les projets";
    all.onclick = () => chooseProject("");
    nav.append(all);
    for (const p of projects) {
      const b = document.createElement("button");
      b.className = "project " + (selectedProject === p.id ? "active" : "");
      b.textContent = p.name;
      b.onclick = () => chooseProject(p.id);
      nav.append(b);
    }
    const client = $("#client");
    const prior = client.value;
    client.replaceChildren(new Option("Tous les clients", ""));
    for (const label of [...new Set(projects.map((p) => p.clientLabel))].sort()) client.append(new Option(label, label));
    client.value = prior;
  }
  async function chooseProject(id) {
    selectedProject = id;
    selectedTicket = "";
    const p = projects.find((x) => x.id === id);
    $("#project-title").textContent = p?.name ?? "Tous les retours";
    $("#client-label").textContent = (p?.clientLabel ?? "TOUS LES CLIENTS").toUpperCase();
    renderProjects();
    await loadTickets();
  }
  async function loadTickets() {
    const params = new URLSearchParams();
    if (selectedProject) params.set("projectId", selectedProject);
    for (const [id, key] of [["status", "status"], ["client", "client"], ["format", "format"]]) {
      const value = $("#" + id).value;
      if (value) params.set(key, value);
    }
    const page = $("#page-filter").value.trim();
    if (page) params.set("page", page);
    tickets = (await api("/api/tickets?" + params)).tickets;
    renderTickets();
    $("#count").textContent = `${tickets.length} retour${tickets.length === 1 ? "" : "s"}`;
    if (!selectedTicket) $("#detail").className = "detail empty";
  }
  function renderTickets() {
    const list = $("#tickets");
    list.replaceChildren();
    for (const t of tickets) {
      const b = document.createElement("button");
      b.className = "ticket " + (selectedTicket === t.id ? "active" : "");
      const status = document.createElement("span");
      status.className = "status " + t.status;
      status.textContent = labels[t.status] ?? t.status;
      const summary = document.createElement("span");
      summary.className = "summary";
      const strong = document.createElement("strong");
      strong.textContent = t.text;
      const small = document.createElement("small");
      small.textContent = `${t.projectName} \xB7 ${new URL(t.pageUrl).pathname}`;
      summary.append(strong, small);
      const date = document.createElement("span");
      date.className = "date";
      date.textContent = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(t.createdAt));
      b.append(status, summary, date);
      b.onclick = () => openTicket(t.id);
      list.append(b);
    }
  }
  function openTicket(id) {
    selectedTicket = id;
    renderTickets();
    const t = tickets.find((x) => x.id === id);
    const d = $("#detail");
    d.className = "detail";
    d.replaceChildren();
    const close = document.createElement("button");
    close.className = "quiet";
    close.textContent = "\u2190 Liste";
    close.onclick = () => {
      d.className = "detail empty";
      selectedTicket = "";
    };
    const eyebrow = document.createElement("div");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = `${t.clientLabel} \xB7 ${t.projectName}`;
    const h = document.createElement("h2");
    h.textContent = t.text;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${t.pageUrl}
${t.anchor.selector} @ ${Math.round(t.anchor.relative.x * 100)}%, ${Math.round(t.anchor.relative.y * 100)}% \xB7 ${t.anchor.viewport.width}\xD7${t.anchor.viewport.height}`;
    const statusLabel = document.createElement("label");
    statusLabel.textContent = "Statut";
    const select = document.createElement("select");
    for (const [v, l] of Object.entries(labels)) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = l;
      o.selected = v === t.status;
      select.append(o);
    }
    statusLabel.append(select);
    const responseLabel = document.createElement("label");
    responseLabel.textContent = "R\xE9ponse interne";
    const textarea = document.createElement("textarea");
    textarea.value = t.response;
    responseLabel.append(textarea);
    const save = document.createElement("button");
    save.textContent = "Enregistrer";
    save.onclick = async () => {
      await api("/api/tickets/" + t.id, { method: "PATCH", body: JSON.stringify({ status: select.value, response: textarea.value }) });
      await loadTickets();
      openTicket(t.id);
    };
    const diagTitle = document.createElement("label");
    diagTitle.textContent = "Diagnostics consentis";
    const diag = document.createElement("pre");
    diag.className = "diag";
    diag.textContent = JSON.stringify(t.diagnostics, null, 2);
    d.append(close, eyebrow, h, meta, statusLabel, responseLabel, save, diagTitle, diag);
    if (t.screenshotId) {
      const a = document.createElement("a");
      a.href = "/api/uploads/" + t.screenshotId;
      a.target = "_blank";
      a.textContent = "Voir la capture priv\xE9e";
      d.append(a);
    }
  }
  for (const id of ["status", "client", "format"]) $("#" + id).addEventListener("change", loadTickets);
  $("#page-filter").addEventListener("input", loadTickets);
  $("#new-project").addEventListener("click", () => $("#project-dialog").showModal());
  document.querySelectorAll(".close").forEach((b) => b.addEventListener("click", () => b.closest("dialog")?.close()));
  $("#project-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const created = await api("/api/projects", { method: "POST", body: JSON.stringify({ name: f.get("name"), clientLabel: f.get("clientLabel"), origins: String(f.get("origins")).split(/\s+/).filter(Boolean) }) });
    $("#project-dialog").close();
    projects = await api("/api/projects");
    await chooseProject(created.id);
  });
  $("#review-link").addEventListener("click", async () => {
    if (!selectedProject) {
      alert("S\xE9lectionnez un projet.");
      return;
    }
    const link = await api(`/api/projects/${selectedProject}/review-links`, { method: "POST" });
    const origin = projects.find((p) => p.id === selectedProject).origins[0];
    $("#link-output").value = `URL reviewer DEMO : ${origin}/${link.fragment}

Installation :
<script src="${location.origin}/widget.js"><\/script>
<script>ReviewDesk.init({api:'${location.origin}',projectId:'${selectedProject}',token:'${link.token}'})<\/script>`;
    $("#link-dialog").showModal();
  });
  $("#logout").addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    showLogin();
  });
  load().catch(showLogin);
})();
