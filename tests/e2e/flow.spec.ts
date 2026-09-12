import { test, expect, type Page } from '@playwright/test';

const ADMIN_PASSWORD = 'grenat-fougere-litanie-8412';
const PREVIEW_ORIGIN = 'http://127.0.0.1:4311';
const API_ORIGIN = 'http://127.0.0.1:4310';

const widget = (page: Page) => page.locator('reviewdesk-widget');

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Mot de passe').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { name: 'Tous les retours' })).toBeVisible();
}

test('a reviewer on another origin files an anchored ticket that the admin triages and can revoke', async ({ page, request }) => {
  const projectName = `DEMO Atelier ${Date.now()}`;
  await login(page);

  // Everything below goes through the real admin UI, so the CSRF token, the
  // dialogs and the filters are exercised rather than the API alone.
  await page.getByRole('button', { name: '＋ Nouveau projet' }).click();
  await page.getByLabel('Nom').fill(projectName);
  await page.getByLabel('Client').fill('DEMO Client A');
  await page.getByLabel('Origines autorisées').fill(PREVIEW_ORIGIN);
  await page.getByRole('button', { name: 'Créer', exact: true }).click();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();

  await page.getByRole('button', { name: 'Liens reviewer' }).click();
  await page.getByRole('button', { name: 'Générer un nouveau lien' }).click();
  await expect(page.locator('#link-output')).toHaveValue(/review=/);
  const instructions = await page.locator('#link-output').inputValue();
  const projectId = /project=([0-9a-f-]{36})/.exec(instructions)![1]!;
  const token = /review=([A-Za-z0-9_-]+)/.exec(instructions)![1]!;
  await page.locator('#link-dialog').getByRole('button', { name: 'Fermer' }).click();

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
  await expect(page.getByRole('heading', { name: 'Tous les retours' })).toBeVisible();
  await page.getByRole('button', { name: projectName, exact: true }).click();

  const ticket = page.getByText('Rendre ce bouton plus visible sur mobile');
  await expect(ticket).toBeVisible();
  await page.locator('#format').selectOption('desktop');
  await expect(ticket).toHaveCount(0, { timeout: 5_000 });
  await page.locator('#format').selectOption('mobile');
  await expect(ticket).toBeVisible();

  await ticket.click();
  await expect(page.getByRole('link', { name: 'Voir la capture privée' })).toBeVisible();
  await expect(page.locator('.ticket-screenshot-preview')).toBeVisible();
  await page.locator('.ticket-screenshot-wrap').click();
  await expect(page.locator('#screenshot-dialog[open]')).toBeVisible();
  await page.locator('#screenshot-dialog-close').click();
  await expect(page.locator('#screenshot-dialog[open]')).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/admin-desktop.png', fullPage: true });
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

  await page.locator('.comment-draft').fill('Vu avec le client : on garde l’orange.');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.locator('.comment')).toContainText('Vu avec le client');
  await expect(page.locator('.comment-meta')).toContainText('Équipe');

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

  await page.getByRole('button', { name: 'Accès agents' }).click();
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

  // The ticket stayed selected behind the dialogs; triage it from there.
  await page.locator('#ticket-status').selectOption('REVIEW');
  await page.getByLabel('Réponse interne').fill('Ajustement prêt à valider');
  await page.getByRole('button', { name: 'Enregistrer' }).click();

  await page.reload();
  await page.getByRole('button', { name: projectName, exact: true }).click();
  await expect(page.locator('.ticket .status.REVIEW')).toHaveText('À valider');
  await page.getByText('Rendre ce bouton plus visible sur mobile').click();
  await expect(page.getByLabel('Réponse interne')).toHaveValue('Ajustement prêt à valider');

  // ------------------------------------------------------ revoke the link

  // Opening the dialog must not mint a second secret: the link revoked below is
  // the one the preview is actually using.
  await page.getByRole('button', { name: 'Liens reviewer' }).click();
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

test('the admin can replay a pin on the preview, and the reviewer reads the answer back', async ({ page }) => {
  const projectName = `DEMO Ancrage ${Date.now()}`;
  await login(page);

  await page.getByRole('button', { name: '＋ Nouveau projet' }).click();
  await page.getByLabel('Nom').fill(projectName);
  await page.getByLabel('Client').fill('DEMO Client B');
  await page.getByLabel('Origines autorisées').fill(PREVIEW_ORIGIN);
  await page.getByRole('button', { name: 'Créer', exact: true }).click();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();

  await page.getByRole('button', { name: 'Liens reviewer' }).click();
  await page.getByRole('button', { name: 'Générer un nouveau lien' }).click();
  await expect(page.locator('#link-output')).toHaveValue(/review=/);
  const instructions = await page.locator('#link-output').inputValue();
  const projectId = /project=([0-9a-f-]{36})/.exec(instructions)![1]!;
  const token = /review=([A-Za-z0-9_-]+)/.exec(instructions)![1]!;
  await page.locator('#link-dialog').getByRole('button', { name: 'Fermer' }).click();

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
  await page.getByRole('button', { name: projectName, exact: true }).click();
  await page.getByText('Le libellé du bouton est ambigu').click();
  await page.getByLabel('Réponse visible par le reviewer').fill('Renommé en « Voir la collection ».');
  await page.locator('#ticket-status').selectOption('DONE');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.locator('#toast')).toHaveText('Retour enregistré.');

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

  await page.getByRole('button', { name: '＋ Nouveau projet' }).click();
  await page.getByLabel('Nom').fill(projectName);
  await page.getByLabel('Client').fill('DEMO Client UX');
  await page.getByLabel('Origines autorisées').fill(PREVIEW_ORIGIN);
  await page.getByRole('button', { name: 'Créer', exact: true }).click();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();

  await page.getByRole('button', { name: 'Liens reviewer' }).click();
  await page.getByRole('button', { name: 'Générer un nouveau lien' }).click();
  await expect(page.locator('#link-output')).toHaveValue(/review=/);
  const instructions = await page.locator('#link-output').inputValue();
  const projectId = /project=([0-9a-f-]{36})/.exec(instructions)![1]!;
  const token = /review=([A-Za-z0-9_-]+)/.exec(instructions)![1]!;
  await page.locator('#link-dialog').getByRole('button', { name: 'Fermer' }).click();

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

  await page.getByRole('button', { name: '＋ Nouveau projet' }).click();
  const projDialog = page.locator('#project-dialog');
  await projDialog.locator('input[name="name"]').fill(projectName);
  await projDialog.locator('input[name="clientLabel"]').fill('DEMO Client Screenshot');
  await projDialog.locator('textarea[name="origins"]').fill(PREVIEW_ORIGIN);
  await projDialog.getByRole('button', { name: 'Créer', exact: true }).click();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();

  await page.getByRole('button', { name: 'Liens reviewer' }).click();
  await page.getByRole('button', { name: 'Générer un nouveau lien' }).click();
  await expect(page.locator('#link-output')).toHaveValue(/review=/);
  const instructions = await page.locator('#link-output').inputValue();
  const projectId = /project=([0-9a-f-]{36})/.exec(instructions)![1]!;
  const token = /review=([A-Za-z0-9_-]+)/.exec(instructions)![1]!;
  await page.locator('#link-dialog').getByRole('button', { name: 'Fermer' }).click();

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
  await page.getByRole('button', { name: projectName, exact: true }).click();

  const ticket1 = page.getByText('Test capture avec styles OKLCH');
  await expect(ticket1).toBeVisible();
  await ticket1.click();
  await expect(page.locator('.ticket-screenshot-preview')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Voir la capture privée' })).toBeVisible();

  const ticket2 = page.getByText('Test capture page entière sans épingle');
  await expect(ticket2).toBeVisible();
  await ticket2.click();
  await expect(page.locator('.ticket-screenshot-preview')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Voir la capture privée' })).toBeVisible();
});

