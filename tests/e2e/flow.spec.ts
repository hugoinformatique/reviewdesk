import { test, expect, type Page } from '@playwright/test';

const ADMIN_PASSWORD = 'grenat-fougere-litanie-8412';
const PREVIEW_ORIGIN = 'http://127.0.0.1:4311';
const API_ORIGIN = 'http://127.0.0.1:4310';

const widget = (page: Page) => page.locator('reviewdesk-widget');

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Mot de passe').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  // Signing in lands on the projects, never on the branding wizard.
  await expect(page.locator('#home')).toBeVisible();
  await expect(page.locator('#home-stats .stat-card')).toHaveCount(4);
  await expect(page.getByRole('dialog', { name: 'Personnalisation de l’instance' })).toBeHidden();
}

/** Back in the admin with a session: the projects, nothing in the way. */
async function backInAdmin(page: Page) {
  await expect(page.locator('#home')).toBeVisible();
  await expect(page.locator('#home-stats .stat-card')).toHaveCount(4);
  await expect(page.getByRole('dialog', { name: 'Personnalisation de l’instance' })).toBeHidden();
}

/**
 * Creates a project the way a user does, through the guide, and reads back
 * the project id and the reviewer token from the install snippet it shows.
 * An empty instance opens the guide by itself; otherwise « Nouveau projet ».
 */
async function createProject(page: Page, name: string, client: string) {
  const guide = page.locator('#guide');
  if (!(await guide.isVisible())) await page.getByRole('button', { name: '＋ Nouveau projet' }).click();
  await guide.getByLabel('Nom du site').fill(name);
  await guide.getByLabel('Client', { exact: true }).fill(client);
  await guide.getByLabel('Adresse du site à faire relire').fill(PREVIEW_ORIGIN);
  await guide.getByRole('button', { name: 'Créer le projet' }).click();
  const snippet = guide.locator('.code');
  await expect(snippet).toContainText('/widget.js#project=');
  const code = (await snippet.textContent())!;
  const projectId = /#project=([0-9a-f-]{36})/.exec(code)![1]!;
  const token = /&token=([A-Za-z0-9_-]+)/.exec(code)![1]!;
  await guide.getByRole('button', { name: 'Continuer' }).click();
  await guide.getByRole('button', { name: 'Ouvrir le projet' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  return { projectId, token };
}

/** Opens a project from the home grid. */
async function openProject(page: Page, name: string) {
  await page.getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

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
  const ticket = page.locator('.ticket', { hasText: 'Rendre ce bouton plus visible sur mobile' });
  await expect(page.locator('[data-column="TODO"] .ticket')).toHaveCount(1);
  await page.locator('#format').selectOption('desktop');
  await expect(ticket).toHaveCount(0, { timeout: 5_000 });
  await page.locator('#format').selectOption('mobile');
  await expect(ticket).toBeVisible();
  await expect(page.getByRole('link', { name: 'Aller au contenu' })).toHaveAttribute('href', '#main-content');
  // The same tickets read as a list, and back; the choice is remembered.
  await page.getByRole('button', { name: 'Liste', exact: true }).click();
  await expect(page.locator('#board.as-list [data-column="TODO"] .ticket')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('#board.as-list')).toBeVisible();
  await page.getByRole('button', { name: 'Tableau', exact: true }).click();
  await expect(page.locator('#board.as-list')).toHaveCount(0);
  // The app is one screen tall: the document itself never scrolls.
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight)).toBeLessThanOrEqual(800);
  await page.screenshot({ path: 'artifacts/admin-desktop.png' });

  // The ticket opens over the board, with its own address.
  await ticket.click();
  await expect(page.locator('#ticket-sheet[open]')).toBeVisible();
  await expect(page).toHaveURL(/#\/p\/[0-9a-f-]{36}\/t\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('link', { name: 'Voir la capture privée' })).toBeVisible();
  await expect(page.locator('.ticket-screenshot-preview')).toBeVisible();
  await page.locator('.ticket-screenshot-wrap').click();
  await expect(page.locator('#screenshot-dialog[open]')).toBeVisible();
  await page.locator('#screenshot-dialog-close').click();
  await expect(page.locator('#screenshot-dialog[open]')).toHaveCount(0);
  // Escape closes the sheet and the address goes back to the board.
  await page.keyboard.press('Escape');
  await expect(page.locator('#ticket-sheet[open]')).toHaveCount(0);
  await expect(page).not.toHaveURL(/\/t\//);
  // --------------------------------------- export the backlog as one prompt

  // Still TODO at this point, so it must appear in the export with its anchor,
  // its page and its screen — everything needed to act on it elsewhere.
  await page.getByRole('button', { name: 'Exporter pour Claude Code' }).click();
  const prompt = page.locator('#export-output');
  await expect(prompt).toHaveValue(/1 retour client à traiter/);
  const exported = await prompt.inputValue();
  expect(exported).toContain('Rendre ce bouton plus visible sur mobile');
  expect(exported).toContain('#hero-cta');
  expect(exported).toContain('(Mobile)');
  expect(exported).toContain(`${PREVIEW_ORIGIN}/demo.html`);
  expect(exported).toContain(projectName);
  expect(exported).not.toContain(token);
  await page.locator('#export-dialog').getByRole('button', { name: 'Fermer' }).click();

  // ------------------------------------------ the work log, from the admin

  await ticket.click();
  await page.getByRole('button', { name: 'Note interne' }).click();
  await page.getByLabel('Note pour l’équipe').fill('Vu avec le client : on garde l’orange.');
  await page.getByRole('button', { name: 'Ajouter la note' }).click();
  await expect(page.locator('.comment')).toContainText('Vu avec le client');
  await expect(page.locator('.comment-meta')).toContainText('Équipe');
  await expect(page.locator('.comment-meta')).toContainText('Interne');
  await page.keyboard.press('Escape');

  // ------------------------------------------------------- the overview

  await page.getByRole('button', { name: 'Vue d’ensemble' }).click();
  const kpis = page.locator('.kpi');
  await expect(kpis.first()).toContainText('À traiter');
  // One ticket was filed, none resolved: the figures must say exactly that.
  await expect(kpis.first().locator('.kpi-value')).toHaveText('1');
  await expect(kpis.nth(3).locator('.kpi-value')).toHaveText('0');
  await expect(page.locator('.panel-projects')).toContainText(projectName);
  await expect(page.locator('.panel-pages')).toContainText('/demo.html');
  // The feed names who moved and on which ticket, not the comment's prose.
  await expect(page.locator('.panel-feed')).toContainText('Équipe');
  await expect(page.locator('.panel-feed')).toContainText('Rendre ce bouton plus visible sur mobile');
  await expect(page.locator('.chart rect')).not.toHaveCount(0);
  // Two shades of grey need a key, or they are just two shades of grey.
  await expect(page.locator('.chart-legend')).toContainText('reçus');
  await expect(page.locator('.chart-legend')).toContainText('traités');

  // The period is part of the question asked, so changing it re-asks it.
  await page.locator('#period').selectOption('7');
  await expect(page.locator('.panel-chart')).toContainText('7 derniers jours');

  await page.getByRole('button', { name: 'Retours', exact: true }).click();
  await expect(page.locator('.ticket')).toHaveCount(1);

  // ------------------------------------ connect an agent, for real this time

  await page.getByRole('button', { name: 'Agents IA', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connecter un agent IA' })).toBeVisible();

  // Step 1: the client decides which configuration gets written.
  // Each tool is announced by its own logo, inlined: a missing symbol renders
  // nothing at all, so the count is the regression guard.
  await expect(page.locator('#agent-picker .agent-card')).toHaveCount(6);
  await expect(page.locator('#agent-picker .logo')).toHaveCount(6);
  await page.getByRole('radio', { name: 'Claude Code' }).click();
  await page.getByRole('button', { name: 'Continuer' }).click();

  // Step 2: the scope is stated in words before anything is minted.
  await page.getByLabel('Libellé du jeton').fill('Claude Code — E2E');
  await expect(page.locator('#agent-scope-note')).toContainText('Claude Code verra');
  await page.getByRole('button', { name: 'Générer le jeton' }).click();

  // Step 3: the secret, the exact command for that client, and a live check.
  const secret = page.locator('.secret-field code');
  await expect(secret).toHaveText(/^rda_/);
  const agentToken = (await secret.textContent())!;
  const snippet = page.locator('.code').first();
  await expect(snippet).toContainText('claude mcp add reviewdesk');
  await expect(snippet).toContainText(agentToken);
  await expect(page.locator('.connection')).toContainText('En attente de votre agent');

  // The agent calls the API for real; the wizard must notice on its own.
  const answered = await request.get('/api/agent/context', {
    headers: { authorization: `Bearer ${agentToken}` },
  });
  expect(answered.status()).toBe(200);
  await expect(page.locator('.connection.connected')).toContainText('Agent connecté', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Terminé' }).click();

  // Connecting the agent was the last unfinished step of the checklist.
  await page.getByRole('button', { name: 'Vue d’ensemble' }).click();
  await expect(page.locator('.onboarding')).toHaveCount(0);
  await page.getByRole('button', { name: 'Retours', exact: true }).click();

  // Triage from the sheet. A status is saved the moment it is picked, and the
  // card changes column behind it.
  await ticket.click();
  await page.locator('#ticket-status').selectOption('REVIEW');
  await expect(page.locator('#toast')).toHaveText('Statut : À valider.');
  await expect(page.locator('[data-column="REVIEW"] .ticket')).toHaveCount(1);
  // A note saved while the board refresh fails stays saved, and says so.
  await page.getByRole('button', { name: 'Note interne' }).click();
  await page.getByLabel('Note pour l’équipe').fill('Ajustement prêt à valider');
  await page.route('**/api/tickets?*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
  await page.getByRole('button', { name: 'Ajouter la note' }).click();
  await expect(page.getByText('Retours indisponibles', { exact: true })).toBeVisible();
  await expect(page.locator('#toast')).toHaveText('Note ajoutée, mais actualisation indisponible.');
  await expect(page.locator('.comment').last()).toContainText('Ajustement prêt à valider');
  await page.unroute('**/api/tickets?*');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
  await expect(page.locator('[data-column="REVIEW"] .ticket')).toHaveCount(1);

  // A reload stays on the project's board, and the note is still there.
  await page.reload();
  await expect(page.locator('[data-column="REVIEW"] .ticket')).toHaveCount(1);
  await ticket.click();
  await expect(page.locator('.comment').last()).toContainText('Ajustement prêt à valider');
  await page.keyboard.press('Escape');

  // ------------------------------------------------------ revoke the link

  // Opening the dialog must not mint a second secret: the link revoked below is
  // the one the preview is actually using.
  await page.getByRole('button', { name: 'Installer', exact: true }).click();
  await expect(page.locator('#link-list .link-row')).toHaveCount(1);
  await page.locator('#link-list').getByRole('button', { name: 'Révoquer' }).click();
  await expect(page.locator('#link-list')).toContainText('Révoqué');
  await page.locator('#link-dialog').getByRole('button', { name: 'Fermer' }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${PREVIEW_ORIGIN}/demo.html${fragment}`);
  await widget(page).getByRole('button', { name: 'Donner mon avis' }).click();
  await widget(page).locator('.target').click();
  const heading = await page.locator('nav .logo').boundingBox();
  if (!heading) throw new Error('the demo header is missing');
  await page.mouse.click(heading.x + heading.width / 2, heading.y + heading.height / 2);
  await widget(page).locator('textarea').fill('Ce retour ne doit pas passer');
  await widget(page).getByRole('button', { name: 'Envoyer mon retour' }).click();
  await expect(widget(page).locator('.msg')).toContainText('Envoi impossible');
  await expect(widget(page).locator('.view-sent')).toBeHidden();
});

test('invalid credentials show the credential error instead of a service outage', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Mot de passe').fill('definitely-not-the-admin-password');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.locator('#login output')).toHaveText('Identifiants invalides.');
});

test('on a phone the dashboard and the board fit the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);

  // Nothing may widen the page past the phone.
  const fits = async (ids: string[]) => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    for (const id of ids) {
      const box = (await page.locator(id).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }
  };
  await fits(['#nav-open', '#project-title']);

  // The rail is a drawer: closed, it is neither drawn nor reachable.
  const newProject = page.getByRole('button', { name: '＋ Nouveau projet' });
  await expect(newProject).toBeHidden();
  await page.getByRole('button', { name: 'Ouvrir la navigation' }).click();
  await expect(newProject).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(newProject).toBeHidden();

  // The board scrolls its columns sideways inside itself, never the page.
  await page.getByRole('button', { name: 'Ouvrir la navigation' }).click();
  await page.getByRole('link', { name: 'Tous les retours' }).click();
  await expect(page.locator('[data-column="TODO"]')).toBeVisible();
  await fits(['#nav-open', '#project-title', '#page-filter']);
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
  await page.locator('.ticket', { hasText: 'Le libellé du bouton est ambigu' }).click();
  await page.getByLabel('Réponse au client').fill('Renommé en « Voir la collection ».');
  await page.getByRole('button', { name: 'Envoyer au client' }).click();
  await expect(page.locator('#toast')).toHaveText('Réponse envoyée au client.');
  // The thread marks the answer the widget now shows.
  await expect(page.locator('.comment.reviewer').last()).toContainText('Renommé en « Voir la collection ».');
  await expect(page.locator('.comment-meta .tag.shown')).toHaveText('Affiché au client');
  await page.locator('#ticket-status').selectOption('DONE');
  await expect(page.locator('#toast')).toHaveText('Statut : Traité.');

  // The deep link is what makes the tool visual rather than a list of selectors.
  const anchorHref = await page.getByRole('link', { name: 'Ouvrir au point d’ancrage' }).getAttribute('href');
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
  await expect(page.locator('.ticket [title="Capture jointe"]')).toHaveCount(2);
  const ticket1 = page.locator('.ticket', { hasText: 'Test capture avec styles OKLCH' });
  await ticket1.click();
  await expect(page.locator('.ticket-screenshot-preview')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Voir la capture privée' })).toBeVisible();
  await page.keyboard.press('Escape');

  const ticket2 = page.locator('.ticket', { hasText: 'Test capture page entière sans épingle' });
  await ticket2.click();
  await expect(page.locator('.ticket-screenshot-preview')).toBeVisible();
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
