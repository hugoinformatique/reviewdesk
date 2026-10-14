import { test, expect, type Locator, type Page } from '@playwright/test';

const ADMIN_PASSWORD = 'grenat-fougere-litanie-8412';
const PREVIEW_ORIGIN = 'http://127.0.0.1:4311';
const API_ORIGIN = 'http://127.0.0.1:4310';

const widget = (page: Page) => page.locator('reviewdesk-widget');

/** The guide is a full-screen dialog whose title changes with each step: it is found by its close button. */
const guideOf = (page: Page) => page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Fermer le guide' }) });

/** The dashboard is up: its four figures are drawn (not skeletons) and no dialog is in the way. */
async function dashboardReady(page: Page) {
  await expect(page.getByRole('heading', { name: 'Votre activité' })).toBeVisible();
  await expect(page.locator('.stat-card')).toHaveCount(4);
  await expect(page.getByText('entre l’arrivée et le traitement')).toBeVisible();
  await expect(page.getByRole('dialog', { name: /Personnalisation/ })).toBeHidden();
}

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Mot de passe').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  // Signing in lands on the projects, never on the branding wizard.
  await dashboardReady(page);
}

/** Back in the admin with a session: the projects, nothing in the way. */
async function backInAdmin(page: Page) {
  await dashboardReady(page);
}

/**
 * Waits until the instance has answered: either the guide opened on its own
 * (no project yet) or the rail lists the existing projects.
 */
async function instanceAnswered(page: Page) {
  await expect
    .poll(async () => (await guideOf(page).isVisible()) || (await page.locator('nav[aria-label="Navigation principale"] a[title*="à traiter"]').count()) > 0)
    .toBe(true);
}

/**
 * Creates a project the way a user does, through the guide, and reads back
 * the project id and the reviewer token from the install snippet it shows.
 * An empty instance opens the guide by itself; otherwise « Nouveau projet ».
 */
async function createProject(page: Page, name: string, client: string) {
  const guide = guideOf(page);
  await instanceAnswered(page);
  if (!(await guide.isVisible())) await page.getByRole('button', { name: '＋ Nouveau projet' }).click();
  await expect(guide).toBeVisible();
  await guide.getByLabel('Nom du site').fill(name);
  await guide.getByLabel('Client', { exact: true }).fill(client);
  await guide.getByLabel('Adresse du site à faire relire').fill(PREVIEW_ORIGIN);
  await guide.getByRole('button', { name: 'Créer le projet' }).click();
  const snippet = guide.locator('pre.code code').first();
  await expect(snippet).toContainText('/widget.js#project=');
  const code = (await snippet.textContent())!;
  const projectId = /#project=([0-9a-f-]{36})/.exec(code)![1]!;
  const token = /&token=([A-Za-z0-9_-]+)/.exec(code)![1]!;
  await guide.getByRole('button', { name: 'Continuer' }).click();
  await guide.getByRole('button', { name: 'Ouvrir le projet' }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  return { projectId, token };
}

/** Opens a project from the rail. */
async function openProject(page: Page, name: string) {
  await page.getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

/** The cards of the board (or the rows of the list), by their data attribute. */
const tickets = (page: Page, column?: 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE') =>
  page.locator(column ? `[data-column="${column}"] [data-ticket-id]` : '[data-ticket-id]');

/** The open ticket sheet, found by its title (the reviewer's text). */
const sheetOf = (page: Page, text: string) => page.getByRole('dialog', { name: text });

/** Picks a value in one of the admin's selects (Radix: trigger, then option). */
async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).click();
}

const tab = (page: Page, name: string | RegExp) => page.getByRole('navigation', { name: 'Sections du projet' }).getByRole('link', { name });

test('a reviewer on another origin files an anchored ticket that the admin triages and can revoke', async ({ page, request }) => {
  const projectName = `DEMO Atelier ${Date.now()}`;
  await login(page);

  // Everything below goes through the real admin UI, so the CSRF token, the
  // dialogs and the filters are exercised rather than the API alone.
  const { projectId, token } = await createProject(page, projectName, 'DEMO Client A');

  // ------------------------------------------------ reviewer, other origin

  await page.setViewportSize({ width: 390, height: 844 });
  const fragment = `#api=${encodeURIComponent(API_ORIGIN)}&project=${projectId}&review=${token}`;
  await page.goto(`${PREVIEW_ORIGIN}/demo.html${fragment}`);
  expect(new URL(page.url()).origin).toBe(PREVIEW_ORIGIN);

  await widget(page).getByRole('button', { name: 'Donner mon avis' }).click();
  await widget(page).locator('.target').click();
  const cta = await page.locator('#hero-cta').boundingBox();
  if (!cta) throw new Error('the demo CTA is missing');
  await page.mouse.click(cta.x + cta.width / 2, cta.y + cta.height / 2);
  await expect(widget(page).locator('.target')).toContainText('Découvrir la collection');
  await expect(widget(page).locator('.pin')).toBeVisible();
  await page.screenshot({ path: 'artifacts/widget-mobile.png', fullPage: true });

  await widget(page).locator('textarea').fill('Rendre ce bouton plus visible sur mobile');
  await widget(page).locator('.diagcheck').check();
  const preview = (await widget(page).locator('.diag').textContent()) ?? '';
  expect(preview).not.toContain('ne-jamais-collecter');
  expect(preview).not.toContain(token);
  expect(preview).not.toContain('review=');
  expect(preview).toContain('Europe/');

  await widget(page).getByRole('button', { name: 'Envoyer mon retour' }).click();
  await expect(widget(page).locator('.view-sent')).toContainText('Retour envoyé');

  // ------------------------------------------------------ admin, triage

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${API_ORIGIN}/`);
  await backInAdmin(page);
  await openProject(page, projectName);

  // The board: the new ticket waits in « À traiter ».
  const text = 'Rendre ce bouton plus visible sur mobile';
  const ticket = tickets(page).filter({ hasText: text });
  await expect(tickets(page, 'TODO')).toHaveCount(1);
  await choose(page, 'Format', 'Ordinateur');
  await expect(ticket).toHaveCount(0, { timeout: 5_000 });
  await choose(page, 'Format', 'Mobile');
  await expect(ticket).toBeVisible();
  await expect(page.getByRole('link', { name: 'Aller au contenu' })).toHaveAttribute('href', '#main-content');
  // The same tickets read as a list, and back; the choice is remembered.
  const listButton = page.getByRole('button', { name: 'Liste', exact: true });
  const boardButton = page.getByRole('button', { name: 'Tableau', exact: true });
  await listButton.click();
  await expect(listButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-column="TODO"]')).toHaveAttribute('aria-label', 'À traiter : 1');
  await expect(tickets(page, 'TODO')).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Liste', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-column="TODO"]')).toHaveAttribute('aria-label', 'À traiter : 1');
  await boardButton.click();
  await expect(boardButton).toHaveAttribute('aria-pressed', 'true');
  await expect(listButton).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-column="TODO"]')).toHaveAttribute('aria-label', 'À traiter : 1 retour');
  // The app is one screen tall: the document itself never scrolls.
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight)).toBeLessThanOrEqual(800);
  await page.screenshot({ path: 'artifacts/admin-desktop.png' });

  // The ticket opens over the board, with its own address.
  await ticket.click();
  await expect(sheetOf(page, text)).toBeVisible();
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]{36}\/t\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('link', { name: 'Voir la capture privée' })).toBeVisible();
  const capture = page.getByRole('img', { name: /^Capture du retour/ });
  await expect(capture).toBeVisible();
  await page.getByRole('button', { name: 'Agrandir la capture' }).click();
  const zoomed = page.getByRole('img', { name: /^Capture agrandie/ });
  await expect(zoomed).toBeVisible();
  await page.getByRole('button', { name: 'Fermer' }).click();
  await expect(zoomed).toHaveCount(0);
  // Escape closes the sheet and the address goes back to the board.
  await page.keyboard.press('Escape');
  await expect(sheetOf(page, text)).toHaveCount(0);
  await expect(page).not.toHaveURL(/\/t\//);
  // --------------------------------------- export the backlog as one prompt

  // Still TODO at this point, so it must appear in the export with its anchor,
  // its page and its screen — everything needed to act on it elsewhere.
  await page.getByRole('button', { name: 'Exporter pour Claude Code' }).click();
  const exportDialog = page.getByRole('dialog', { name: 'Exporter pour Claude Code' });
  const prompt = exportDialog.getByRole('textbox', { name: 'Prompt à copier' });
  await expect(prompt).toHaveValue(/1 retour client à traiter/);
  const exported = await prompt.inputValue();
  expect(exported).toContain('Rendre ce bouton plus visible sur mobile');
  expect(exported).toContain('#hero-cta');
  expect(exported).toContain('(Mobile)');
  expect(exported).toContain(`${PREVIEW_ORIGIN}/demo.html`);
  expect(exported).toContain(projectName);
  expect(exported).not.toContain(token);
  await exportDialog.getByRole('button', { name: 'Fermer' }).first().click();
  await expect(exportDialog).toHaveCount(0);

  // ------------------------------------------ the work log, from the admin

  await ticket.click();
  await page.getByRole('button', { name: 'Note interne' }).click();
  await page.getByLabel('Note pour l’équipe').fill('Vu avec le client : on garde l’orange.');
  await page.getByRole('button', { name: 'Ajouter la note' }).click();
  const thread = page.getByRole('region', { name: 'Conversation' });
  const note = thread.getByRole('listitem').filter({ hasText: 'Vu avec le client' });
  await expect(note).toBeVisible();
  await expect(note).toContainText('Équipe');
  await expect(note).toContainText('Interne');
  await page.keyboard.press('Escape');

  // ------------------------------------------------------- the overview

  // Nobody is connected yet: the checklist is still on the page.
  await tab(page, /Vue d.ensemble/).click();
  await expect(page.getByRole('region', { name: 'Mise en route' })).toBeVisible();
  const kpi = (name: string | RegExp) => page.getByRole('group', { name });
  await expect(kpi('À traiter')).toBeVisible();
  // One ticket was filed, none resolved: the figures must say exactly that.
  await expect(kpi('À traiter')).toHaveText(/^À traiter1/);
  await expect(kpi(/^Traités/)).toHaveText(/^Traités · 30 j0/);
  await expect(page.getByRole('region', { name: 'Par projet' })).toContainText(projectName);
  await expect(page.getByRole('region', { name: 'Pages les plus signalées' })).toContainText('/demo.html');
  // The feed names who moved and on which ticket, not the comment's prose.
  const feed = page.getByRole('region', { name: 'Derniers mouvements' });
  await expect(feed).toContainText('Équipe');
  await expect(feed).toContainText('Rendre ce bouton plus visible sur mobile');
  const activity = page.getByRole('region', { name: /^Activité/ });
  await expect(activity.locator('.recharts-rectangle').first()).toBeAttached();
  // Two shades of grey need a key, or they are just two shades of grey.
  await expect(activity).toContainText('reçus');
  await expect(activity).toContainText('traités');

  // The period is part of the question asked, so changing it re-asks it.
  await page.getByRole('radio', { name: '7 jours' }).click();
  await expect(page.getByRole('region', { name: /^Activité/ })).toContainText('7 derniers jours');

  await tab(page, 'Retours').click();
  await expect(tickets(page)).toHaveCount(1);

  // ------------------------------------ connect an agent, for real this time

  await page.getByRole('button', { name: 'Agents IA', exact: true }).click();
  // The dialog is renamed at its last step (« Connecter Claude Code »): it is the only one open.
  const agentDialog = page.getByRole('dialog');
  await expect(agentDialog.getByRole('heading', { name: 'Connecter un agent IA' })).toBeVisible();

  // Step 1: the client decides which configuration gets written.
  // Each tool is announced by its own logo, inlined: a missing symbol renders
  // nothing at all, so the count is the regression guard.
  const picker = agentDialog.getByRole('radiogroup', { name: 'Outil à connecter' });
  await expect(picker.getByRole('radio')).toHaveCount(6);
  await expect(picker.getByRole('radio').locator('svg')).toHaveCount(6);
  for (const logo of await picker.getByRole('radio').locator('svg').all()) {
    const box = await logo.boundingBox();
    expect(box && box.width > 0 && box.height > 0).toBe(true);
  }
  await picker.getByRole('radio', { name: /^Claude Code/ }).click();
  await agentDialog.getByRole('button', { name: 'Continuer' }).click();

  // Step 2: the scope is stated in words before anything is minted.
  await agentDialog.getByLabel('Libellé du jeton').fill('Claude Code — E2E');
  await expect(agentDialog.getByText(/Claude Code verra/)).toBeVisible();
  await agentDialog.getByRole('button', { name: 'Générer le jeton' }).click();

  // Step 3: the secret, the exact command for that client, and a live check.
  const secret = agentDialog.getByTestId('agent-token');
  await expect(secret).toHaveText(/^rda_/);
  const agentToken = (await secret.textContent())!;
  const command = agentDialog.locator('pre').first();
  await expect(command).toContainText('claude mcp add reviewdesk');
  await expect(command).toContainText(agentToken);
  await expect(agentDialog.getByRole('status').filter({ hasText: 'En attente de votre agent' })).toBeVisible();

  // The agent calls the API for real; the wizard must notice on its own.
  const answered = await request.get('/api/agent/context', {
    headers: { authorization: `Bearer ${agentToken}` },
  });
  expect(answered.status()).toBe(200);
  await expect(agentDialog.getByRole('status').filter({ hasText: 'Agent connecté' })).toBeVisible({ timeout: 15_000 });
  await agentDialog.getByRole('button', { name: 'Terminé' }).click();
  await expect(agentDialog).toHaveCount(0);

  // Connecting the agent was the last unfinished step of the checklist.
  await tab(page, /Vue d.ensemble/).click();
  await expect(page.getByRole('region', { name: 'Agents IA' })).toContainText('agent connecté');
  await expect(page.getByRole('region', { name: 'Mise en route' })).toHaveCount(0);
  await tab(page, 'Retours').click();

  // Triage from the sheet. A status is saved the moment it is picked, and the
  // card changes column behind it.
  await ticket.click();
  await choose(page, 'Statut', 'À valider');
  await expect(page.getByText('Statut : À valider.')).toBeVisible();
  await expect(tickets(page, 'REVIEW')).toHaveCount(1);
  // A note saved while the board refresh fails stays saved, and says so.
  await page.getByRole('button', { name: 'Note interne' }).click();
  await page.getByLabel('Note pour l’équipe').fill('Ajustement prêt à valider');
  await page.route('**/api/tickets?*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
  await page.getByRole('button', { name: 'Ajouter la note' }).click();
  await expect(page.getByText('Retours indisponibles', { exact: true })).toBeVisible();
  await expect(page.getByText('Note ajoutée, mais actualisation indisponible.')).toBeVisible();
  await expect(thread.getByRole('listitem').last()).toContainText('Ajustement prêt à valider');
  await page.unroute('**/api/tickets?*');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
  await expect(tickets(page, 'REVIEW')).toHaveCount(1);
  await expect(page.getByText('Retours indisponibles', { exact: true })).toHaveCount(0);

  // A reload stays on the project's board, and the note is still there.
  await page.reload();
  await expect(tickets(page, 'REVIEW')).toHaveCount(1);
  await ticket.click();
  await expect(thread.getByRole('listitem').last()).toContainText('Ajustement prêt à valider');
  await page.keyboard.press('Escape');

  // ------------------------------------------------------ revoke the link

  // Opening the dialog must not mint a second secret: the link revoked below is
  // the one the preview is actually using.
  await page.getByRole('button', { name: 'Installer', exact: true }).click();
  const installDialog = page.getByRole('dialog', { name: 'Installer le widget' });
  const links = installDialog.getByRole('region', { name: 'Liens de ce projet' });
  await expect(links.getByRole('listitem')).toHaveCount(1);
  await links.getByRole('button', { name: 'Révoquer' }).click();
  await expect(links).toContainText('Révoqué');
  await installDialog.getByRole('button', { name: 'Fermer' }).click();
  await expect(installDialog).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${PREVIEW_ORIGIN}/demo.html${fragment}`);
  await widget(page).getByRole('button', { name: 'Donner mon avis' }).click();
  await widget(page).locator('.target').click();
  const logo = await page.locator('nav .logo').boundingBox();
  if (!logo) throw new Error('the demo header is missing');
  await page.mouse.click(logo.x + logo.width / 2, logo.y + logo.height / 2);
  await widget(page).locator('textarea').fill('Ce retour ne doit pas passer');
  await widget(page).getByRole('button', { name: 'Envoyer mon retour' }).click();
  await expect(widget(page).locator('.msg')).toContainText('Envoi impossible');
  await expect(widget(page).locator('.view-sent')).toBeHidden();
});

test('invalid credentials show the credential error instead of a service outage', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Mot de passe').fill('definitely-not-the-admin-password');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Identifiants invalides.' })).toHaveText('Identifiants invalides.');
});

test('on a phone the dashboard and the board fit the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  // An empty instance opens the guide by itself; this test is about the shell.
  await instanceAnswered(page);
  const guide = guideOf(page);
  if (await guide.isVisible()) {
    await guide.getByRole('button', { name: 'Fermer le guide' }).click();
    await expect(guide).toHaveCount(0);
  }

  const navOpen = page.getByRole('button', { name: 'Ouvrir la navigation' });
  const title = page.getByRole('heading', { level: 1 });
  const pageFilter = page.getByLabel('Filtrer par page');

  // Nothing may widen the page past the phone.
  const fits = async (...elements: Locator[]) => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    for (const element of elements) {
      const box = (await element.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }
  };
  await fits(navOpen, title);

  // The rail is a drawer: closed, it is neither drawn nor reachable.
  const newProject = page.getByRole('button', { name: '＋ Nouveau projet' });
  await expect(newProject).toBeHidden();
  await navOpen.click();
  await expect(newProject).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(newProject).toBeHidden();

  // The board scrolls its columns sideways inside itself, never the page.
  await navOpen.click();
  await page.getByRole('link', { name: 'Tous les retours' }).click();
  // Run alone on an empty instance there is no ticket yet, hence no column: the empty state stands in.
  await expect(page.locator('[data-column="TODO"]').or(page.getByText('Aucun retour pour l\'instant'))).toBeVisible();
  await expect(title).toHaveText('Tous les retours');
  await fits(navOpen, title, pageFilter);
});

test('the admin can replay a pin on the preview, and the reviewer reads the answer back', async ({ page }) => {
  const projectName = `DEMO Ancrage ${Date.now()}`;
  await login(page);

  const { projectId, token } = await createProject(page, projectName, 'DEMO Client B');

  const credentials = `api=${encodeURIComponent(API_ORIGIN)}&project=${projectId}&review=${token}`;
  await page.goto(`${PREVIEW_ORIGIN}/demo.html#${credentials}`);
  await widget(page).getByRole('button', { name: 'Donner mon avis' }).click();
  await widget(page).locator('.target').click();
  const cta = (await page.locator('#hero-cta').boundingBox())!;
  await page.mouse.click(cta.x + cta.width / 2, cta.y + cta.height / 2);
  await widget(page).locator('textarea').fill('Le libellé du bouton est ambigu');
  await widget(page).getByRole('button', { name: 'Envoyer mon retour' }).click();
  await expect(widget(page).locator('.view-sent')).toContainText('Retour envoyé');

  // ------------------------------------------- the admin answers the reviewer

  await page.goto(`${API_ORIGIN}/`);
  await backInAdmin(page);
  await openProject(page, projectName);
  const asked = 'Le libellé du bouton est ambigu';
  await tickets(page).filter({ hasText: asked }).click();
  const thread = page.getByRole('region', { name: 'Conversation' });
  // An internal note is for the team: the reviewer must never read it.
  await page.getByRole('button', { name: 'Note interne' }).click();
  await page.getByLabel('Note pour l’équipe').fill('Note équipe jamais visible du client');
  await page.getByRole('button', { name: 'Ajouter la note' }).click();
  await expect(page.getByText('Note ajoutée.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Répondre au client' }).click();
  await page.getByLabel('Réponse au client').fill('Renommé en « Voir la collection ».');
  await page.getByRole('button', { name: 'Envoyer au client' }).click();
  await expect(page.getByText('Réponse envoyée au client.')).toBeVisible();
  // The thread marks the answer the widget now shows.
  const answer = thread.getByRole('listitem').filter({ hasText: 'Renommé en « Voir la collection ».' });
  await expect(answer).toBeVisible();
  await expect(answer).toContainText('Affiché au client');
  await expect(thread.getByText('Affiché au client')).toHaveCount(1);
  await choose(page, 'Statut', 'Traité');
  await expect(page.getByText('Statut : Traité.')).toBeVisible();

  // The deep link is what makes the tool visual rather than a list of selectors.
  const anchorHref = await page.getByRole('link', { name: /Ouvrir au point d.ancrage/ }).getAttribute('href');
  const anchorFragment = /#rd-anchor=(.+)$/.exec(anchorHref!)![1]!;

  // A reviewer opening that spot carries their own link, exactly as they would
  // from their browser: the admin never holds the reviewer secret.
  await page.goto(`${PREVIEW_ORIGIN}/demo.html#${credentials}&rd-anchor=${anchorFragment}`);
  const replayed = widget(page).locator('.pin.replay');
  await expect(replayed).toBeVisible();
  await expect(replayed).not.toHaveClass(/missing/);

  const pin = (await replayed.boundingBox())!;
  const anchored = (await page.locator('#hero-cta').boundingBox())!;
  expect(pin.x).toBeGreaterThanOrEqual(anchored.x - 20);
  expect(pin.x).toBeLessThanOrEqual(anchored.x + anchored.width + 20);

  // ------------------------------------------------- the reviewer reads back

  // Reading the answer must cost nothing: opening the widget and switching to
  // the list files no comment and places no pin.
  await widget(page).getByRole('button', { name: /Faire un retour|Donner mon avis/ }).click();
  await widget(page).locator('.tab-mine').click();
  const entry = widget(page).locator('.mine .item').first();
  await expect(entry).toContainText('Le libellé du bouton est ambigu');
  await expect(entry).toContainText('Traité');
  await expect(entry).toContainText('Renommé en « Voir la collection ».');
  await expect(entry).not.toContainText('Note équipe jamais visible du client');
  await expect(widget(page).locator('.mine')).not.toContainText('Note équipe jamais visible du client');
});

test('client experience: monochrome UI, launcher label, pin cancellation and shortcuts', async ({ page }) => {
  const projectName = `DEMO Client UX ${Date.now()}`;
  await login(page);

  const { projectId, token } = await createProject(page, projectName, 'DEMO Client UX');

  const credentials = `api=${encodeURIComponent(API_ORIGIN)}&project=${projectId}&review=${token}`;
  await page.goto(`${PREVIEW_ORIGIN}/demo.html#${credentials}`);

  // 1. Check launcher has "Faire un retour" and [C] badge
  const fab = widget(page).locator('.fab');
  await expect(fab).toBeVisible();
  await expect(fab).toContainText('Faire un retour');
  await expect(fab.locator('.fab-kbd')).toHaveText('C');

  // 2. Shortcut [C]: opens and closes widget
  await page.keyboard.press('c');
  const panel = widget(page).locator('.panel');
  await expect(panel).toBeVisible();
  await page.keyboard.press('c');
  await expect(panel).toBeHidden();

  // 3. Shortcut [P]: triggers pointer directly
  await page.keyboard.press('p');
  const pickOverlay = widget(page).locator('.pick');
  await expect(pickOverlay).toBeVisible();

  // Click on CTA to place a pin
  const cta = (await page.locator('#hero-cta').boundingBox())!;
  await page.mouse.click(cta.x + cta.width / 2, cta.y + cta.height / 2);

  await expect(panel).toBeVisible();
  await expect(widget(page).locator('.pin')).toBeVisible();
  await expect(widget(page).locator('.target-cancel')).toBeVisible();

  // 4. Pin cancellation via ✕ Retirer button
  await widget(page).locator('.target-cancel').click();
  await expect(widget(page).locator('.pin')).toHaveCount(0);
  await expect(widget(page).locator('.target-cancel')).toBeHidden();
  await expect(widget(page).locator('.target .lbl')).toContainText('Cliquez ici');

  // 5. Place pin again and cancel via direct click on the pin
  await widget(page).locator('.target').click();
  await page.mouse.click(cta.x + cta.width / 2, cta.y + cta.height / 2);
  await expect(widget(page).locator('.pin')).toBeVisible();

  await widget(page).locator('.pin').click();
  await expect(widget(page).locator('.pin')).toHaveCount(0);
  await expect(widget(page).locator('.target-cancel')).toBeHidden();

  // 6. Place pin again and cancel via Escape
  await widget(page).locator('.target').click();
  await page.mouse.click(cta.x + cta.width / 2, cta.y + cta.height / 2);
  await expect(widget(page).locator('.pin')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(widget(page).locator('.pin')).toHaveCount(0);
  await expect(panel).toBeVisible(); // panel stays open, anchor reset

  // 7. Place pin, select category chip with shortcut 1, fill text and submit with Cmd+Enter
  await widget(page).locator('.target').click();
  await page.mouse.click(cta.x + cta.width / 2, cta.y + cta.height / 2);
  await expect(widget(page).locator('.pin')).toBeVisible();

  // Press 1 for Bug category chip
  await widget(page).locator('.category-chips .chip').first().click();
  await expect(widget(page).locator('textarea')).toHaveValue(/\[Bug\]/);

  await widget(page).locator('textarea').fill('[Bug] Bouton CTA non réactif');
  await page.keyboard.press('Meta+Enter');
  await expect(widget(page).locator('.view-sent')).toContainText('Retour envoyé');
});

test('client screenshot capture works reliably with modern OKLCH styles and displays in admin', async ({ page }) => {
  const projectName = `DEMO Screenshot ${Date.now()}`;
  await login(page);

  const { projectId, token } = await createProject(page, projectName, 'DEMO Client Screenshot');

  const credentials = `api=${encodeURIComponent(API_ORIGIN)}&project=${projectId}&review=${token}`;
  await page.goto(`${PREVIEW_ORIGIN}/demo.html#${credentials}`);

  // Inject modern OKLCH styles and an iframe to stress-test capture
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `
      body {
        background-color: oklch(0.95 0.05 120) !important;
        color: oklch(0.2 0.05 200) !important;
      }
      #hero-cta {
        background-color: color-mix(in srgb, oklch(0.6 0.2 240) 80%, white) !important;
        border: 2px solid oklch(0.5 0.15 150) !important;
        box-shadow: 0 4px 6px oklch(0.3 0.1 260 / 0.2) !important;
      }
    `;
    document.head.append(style);

    const iframe = document.createElement('iframe');
    iframe.src = 'about:blank';
    iframe.style.width = '100px';
    iframe.style.height = '100px';
    document.body.append(iframe);
  });

  // 1. Submit anchored ticket on modern styled element
  await widget(page).locator('.fab').click();
  await widget(page).locator('.target').click();
  const cta = (await page.locator('#hero-cta').boundingBox())!;
  await page.mouse.click(cta.x + cta.width / 2, cta.y + cta.height / 2);
  await widget(page).locator('textarea').fill('Test capture avec styles OKLCH');
  await widget(page).getByRole('button', { name: 'Envoyer mon retour' }).click();
  await expect(widget(page).locator('.view-sent')).toContainText('Retour envoyé');

  // 2. Submit un-anchored ticket ("Page entière")
  await widget(page).getByRole('button', { name: 'Écrire un autre retour' }).click();
  await widget(page).locator('textarea').fill('Test capture page entière sans épingle');
  await widget(page).getByRole('button', { name: 'Envoyer mon retour' }).click();
  await expect(widget(page).locator('.view-sent')).toContainText('Retour envoyé');

  // 3. Admin verifies both tickets have screenshot attached and visible
  await page.goto(`${API_ORIGIN}/`);
  await backInAdmin(page);
  await openProject(page, projectName);

  // Both cards show the capture as their thumbnail, and so does each sheet.
  await expect(page.getByRole('img', { name: 'Capture jointe' })).toHaveCount(2);
  const first = 'Test capture avec styles OKLCH';
  await tickets(page).filter({ hasText: first }).click();
  await expect(sheetOf(page, first).getByRole('img', { name: /^Capture du retour/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Voir la capture privée' })).toBeVisible();
  await page.keyboard.press('Escape');

  const second = 'Test capture page entière sans épingle';
  await tickets(page).filter({ hasText: second }).click();
  await expect(sheetOf(page, second).getByRole('img', { name: /^Capture du retour/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Voir la capture privée' })).toBeVisible();
});


test('a reviewer’s text stays text in the collaborative pins on the client page', async ({ page, request }) => {
  await login(page);
  const projectName = `XSS ${Date.now()}`;
  const { projectId, token } = await createProject(page, projectName, 'Agence témoin');

  // Filed straight through the API, as a hostile reviewer holding a link could.
  const payload = '<img src=x onerror="window.__rdInjected=1">';
  const filed = await request.post(`${API_ORIGIN}/api/feedback`, {
    headers: { authorization: `Bearer ${token}`, origin: PREVIEW_ORIGIN },
    data: {
      projectId,
      text: payload,
      pageUrl: `${PREVIEW_ORIGIN}/demo.html`,
      anchor: { selector: '#hero-cta', relative: { x: 0.5, y: 0.5 }, viewport: { width: 1280, height: 720 } },
    },
  });
  expect(filed.status()).toBe(201);

  await page.goto(`${PREVIEW_ORIGIN}/demo.html#api=${encodeURIComponent(API_ORIGIN)}&project=${projectId}&review=${token}`);
  const tip = widget(page).locator('.collab-pin .collab-tip-text');
  await expect(tip).toHaveText(payload);
  await expect(widget(page).locator('.collab-pin img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __rdInjected?: number }).__rdInjected)).toBeUndefined();

  // The admin reads the same text as text, on the card and in the sheet.
  await page.goto(`${API_ORIGIN}/`);
  await backInAdmin(page);
  await openProject(page, projectName);
  const card = tickets(page).filter({ hasText: payload });
  await expect(card).toHaveCount(1);
  await expect(card.locator('img')).toHaveCount(0);
  await card.click();
  await expect(sheetOf(page, payload)).toBeVisible();
  await expect(sheetOf(page, payload).locator('img[src="x"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __rdInjected?: number }).__rdInjected)).toBeUndefined();
});

test('the one-line install and the no-code bookmark both bring the widget up on a bare page', async ({ page, request }) => {
  await login(page);
  const projectName = `Sans code ${Date.now()}`;
  const { projectId, token } = await createProject(page, projectName, 'Agence témoin');

  // The plugin WordPress asks for is served, as a real ZIP.
  const plugin = await request.get(`${API_ORIGIN}/integrations/reviewdesk-wordpress.zip`);
  expect(plugin.status()).toBe(200);
  expect((await plugin.body()).subarray(0, 4).toString('latin1')).toBe('PK\x03\x04');

  // The pasted line alone, loaded from another origin as on a client's site
  // (this once failed on Cross-Origin-Resource-Policy: same-origin).
  await page.goto(`${PREVIEW_ORIGIN}/demo.html`);
  await expect(widget(page)).toHaveCount(0);
  await page.evaluate((src) => {
    const script = document.createElement('script');
    script.src = src;
    document.body.append(script);
  }, `${API_ORIGIN}/widget.js#project=${projectId}&token=${token}&label=Un%20avis%20%3F`);
  await expect(widget(page).locator('.fab-label')).toHaveText('Un avis ?');

  // The review page hands out a bookmark; run it the way a click would.
  await page.goto(`${API_ORIGIN}/relecture.html#project=${projectId}&token=${token}&site=${encodeURIComponent(PREVIEW_ORIGIN)}`);
  await expect(page.locator('#site-link')).toHaveAttribute('href', `${PREVIEW_ORIGIN}/`);
  const href = (await page.locator('#bookmarklet').getAttribute('href'))!;
  expect(href).toMatch(/^javascript:/);
  expect(href).toContain(`${API_ORIGIN}/widget.js#project=${projectId}&token=${token}`);

  // A crafted link cannot point the bookmark at another server.
  await page.goto(`${API_ORIGIN}/relecture.html#api=https%3A%2F%2Fevil.example&project=${projectId}&token=${token}`);
  expect(await page.locator('#bookmarklet').getAttribute('href')).not.toContain('evil.example');

  await page.goto(`${PREVIEW_ORIGIN}/demo.html`);
  await page.evaluate((code) => new Function(code)(), decodeURIComponent(href.slice('javascript:'.length)));
  await widget(page).getByRole('button', { name: 'Donner mon avis' }).click();
  await expect(widget(page).locator('textarea')).toBeVisible();

  // A broken link explains itself instead of handing out a dead bookmark.
  await page.goto(`${API_ORIGIN}/relecture.html#project=nope`);
  await expect(page.locator('#review-error')).toBeVisible();
});
