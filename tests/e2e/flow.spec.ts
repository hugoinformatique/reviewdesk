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

test('a reviewer on another origin files an anchored ticket that the admin triages and can revoke', async ({ page }) => {
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

  // -------------------------------------------------- an agent token to mint

  await page.getByRole('button', { name: 'Accès agents' }).click();
  await page.getByLabel('Libellé').fill('Claude Code — E2E');
  await page.getByRole('button', { name: 'Générer un jeton' }).click();
  const agentOutput = page.locator('#agent-output');
  await expect(agentOutput).toHaveValue(/rda_/);
  const mcpConfig = await agentOutput.inputValue();
  expect(mcpConfig).toContain('claude mcp add reviewdesk');
  expect(mcpConfig).toContain('/api/agent/tickets?status=TODO');
  await expect(page.locator('#agent-list')).toContainText('Claude Code — E2E');
  await page.locator('#agent-list').getByRole('button', { name: 'Révoquer' }).click();
  await expect(page.locator('#agent-list')).toContainText('révoqué');
  await page.locator('#agent-dialog').getByRole('button', { name: 'Fermer' }).click();

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
  await widget(page).getByRole('button', { name: 'Donner mon avis' }).click();
  await widget(page).locator('.tab-mine').click();
  const entry = widget(page).locator('.mine .item').first();
  await expect(entry).toContainText('Le libellé du bouton est ambigu');
  await expect(entry).toContainText('Traité');
  await expect(entry).toContainText('Renommé en « Voir la collection ».');
});
