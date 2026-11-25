import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { initialBackup } from '../src/data';

test('all screens work without AI and fit the viewport', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Workspace' });
  for (const name of ['This week', 'Map', 'Signal', 'Engage', 'Outreach', 'Convert', 'Board track', 'Insights', 'Tools & Setup']) {
    await nav.getByRole('link', { name, exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(page.getByText(/AI is off because the server has no Anthropic API key/).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
  }
  await nav.getByRole('link', { name: 'Signal' }).click();
  await expect(page.getByRole('button', { name: 'AI gap notes' })).toBeDisabled();
});

test('WebKit touch controls are at least 44px tall', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'webkit', 'iPhone and iPad WebKit regression');
  if (testInfo.project.name === 'iphone') {
    await page.setViewportSize({ width: 390, height: 780 });
  } else {
    await page.emulateMedia({ colorScheme: 'dark' });
  }
  const screens = ['This week', 'Map', 'Signal', 'Engage', 'Outreach', 'Convert', 'Board track', 'Insights', 'Tools & Setup'];
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Weekly cadence' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Workspace' });
  for (const name of screens) {
    await nav.getByRole('link', { name, exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    if (name === 'Map') await page.getByText('Edit targets and aliases', { exact: true }).click();
    for (const add of await page.getByRole('button', { name: /^Add / }).all()) await add.click();
    await page.locator('details:not([open])').evaluateAll(details => {
      for (const detail of details) (detail as HTMLDetailsElement).open = true;
    });
    if (name === 'Signal') await expect(page.getByRole('combobox', { name: 'Stage', exact: true })).toBeVisible();
    if (name === 'Outreach') await expect(page.getByRole('combobox', { name: 'Script', exact: true })).toBeVisible();
    const undersized = await page.locator('select:visible, button:visible, input:visible').evaluateAll(controls =>
      controls.flatMap(control => {
        const height = control.getBoundingClientRect().height;
        if (height >= 44) return [];
        const label = (control as HTMLInputElement).labels?.[0]?.firstChild?.textContent?.trim();
        return [{ control: control.tagName, label: label || control.getAttribute('aria-label') || control.textContent?.trim(), height }];
      }));
    expect.soft(undersized, `${name}: visible controls shorter than 44px`).toEqual([]);
  }
});

test('manual outreach, local matching and scout imports persist after reload', async ({ page }) => {
  await page.goto('/#setup');
  await page.getByLabel('Resume', { exact: true }).fill('FinOps Craft');
  await page.getByRole('link', { name: 'Signal' }).click();
  await expect(page.getByRole('heading', { name: 'Signal', exact: true })).toBeFocused();
  await page.getByLabel('Scout digest email', { exact: true }).fill('Niall Search OS digest - Today\n[8/10] Head of Craft - Northwind\n    Remote\n    Why: Relevant\n    https://example.invalid/role');
  await page.getByRole('button', { name: 'Import digest' }).click();
  await expect(page.getByText('Added 1 roles.')).toBeVisible();
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await page.getByText('Head of Craft', { exact: true }).first().click();
  await page.getByLabel('Source', { exact: true }).fill('Fabrikam');
  await page.getByLabel('Description to match', { exact: true }).fill('Governance FinOps');
  await expect(page.getByText('50% match')).toBeVisible();
  await page.getByRole('link', { name: 'Outreach' }).click();
  await expect(page.getByRole('heading', { name: 'Outreach', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Add outreach' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Avery Example');
  await page.getByRole('button', { name: 'Use script as draft' }).click();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copy text' })).toBeEnabled();
  await page.getByRole('button', { name: 'Mark sent' }).click();
  await page.getByRole('button', { name: 'Replied', exact: true }).click();
  await page.getByRole('link', { name: 'Insights' }).click();
  await expect(page.getByText('100% (1/1)').first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('100% (1/1)').first()).toBeVisible();
  await expect(page.getByText('Fabrikam')).toBeVisible();
});

test('backup survives import, IndexedDB reload and download', async ({ page }) => {
  const original = initialBackup();
  original.settings.positioning = 'Contoso';
  original.targets = [{ name: 'Fabrikam', extension: { keep: [true, 1] } }];
  original.contacts = [{ name: 'Avery Example' }];
  original.roles = [{ title: 'Head of Craft' }];
  original.refs.push({ name: 'Casey Example', example: true, extension: false });
  await page.goto('/#setup');
  page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('Import JSON backup').setInputFiles({
    name: 'workspace.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(original)),
  });
  await expect(page.getByText('Backup imported.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Positioning', { exact: true })).toHaveValue('Contoso');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON backup' }).click();
  const download = await downloaded;
  const restored = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(restored).toMatchObject(original);
  expect(restored.targets[0].id).toEqual(expect.any(String));
  expect(restored.refs[0].id).toEqual(expect.any(String));
  await page.getByRole('link', { name: 'Outreach', exact: true }).click();
  await page.getByRole('button', { name: 'Add outreach' }).click();
  const target = page.getByRole('combobox', { name: 'Target', exact: true });
  const contact = page.getByRole('combobox', { name: 'Saved contact', exact: true });
  await target.selectOption({ label: 'Fabrikam' });
  await contact.selectOption({ label: 'Avery Example' });
  await expect(target).toHaveValue(restored.targets[0].id);
  await expect(contact).toHaveValue(restored.contacts[0].id);
  await page.getByRole('link', { name: 'Signal', exact: true }).click();
  const role = page.getByRole('combobox', { name: 'Role', exact: true });
  await role.selectOption({ label: 'Head of Craft' });
  await expect(role).toHaveValue(restored.roles[0].id);
});

test('a stale tab cannot overwrite another tab’s saved changes', async ({ page, context }) => {
  const second = await context.newPage();
  for (const tab of [page, second]) {
    await tab.goto('/#setup');
    await expect(tab.getByLabel('Positioning', { exact: true })).toBeVisible();
  }
  await page.getByLabel('Positioning', { exact: true }).fill('Northwind');
  await expect.poll(() => page.evaluate(() => new Promise<string | undefined>((resolve, reject) => {
    const open = indexedDB.open('niall-search-os');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction('workspace');
      const read = transaction.objectStore('workspace').get('current');
      transaction.oncomplete = () => { db.close(); resolve(read.result?.settings.positioning); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  }))).toBe('Northwind');
  await second.getByLabel('Resume', { exact: true }).fill('Fabrikam');
  await expect(second.getByText(/Another tab saved changes first/)).toBeVisible();
  await expect(second.getByLabel('Resume', { exact: true })).toHaveValue('Fabrikam');
  await second.reload();
  await expect(second.getByLabel('Positioning', { exact: true })).toHaveValue('Northwind');
  await expect(second.getByLabel('Resume', { exact: true })).toHaveValue('');
});

test.describe('AI proxy controls', () => {
  test.use({ serviceWorkers: 'block' });

  test('AI requires the local Setup code and handles rejection', async ({ page }) => {
    await page.route('**/api/ai', async route => {
      const request = route.request();
      if (request.method() === 'GET') {
        await route.fulfill({ json: { enabled: true, accessCodeRequired: true, reason: '' } });
      } else if (request.headers()['x-ai-access-code-base64'] === Buffer.from('fictional-code-€').toString('base64')) {
        await route.fulfill({ json: { draft: 'Northwind draft' } });
      } else await route.fulfill({ status: 401 });
    });
    await page.goto('/#signal');
    const draft = page.getByRole('button', { name: 'AI gap notes', exact: true });
    await expect(page.getByText('Enter the AI access code in Setup to enable drafting.').first()).toBeVisible();
    await expect(draft).toBeDisabled();
    const setup = page.getByRole('link', { name: 'Tools & Setup' });
    const signal = page.getByRole('link', { name: 'Signal', exact: true });
    const code = page.getByLabel('AI access code', { exact: true });
    const save = page.getByRole('button', { name: 'Save AI access code' });
    await setup.click();
    await expect(page.getByRole('heading', { name: 'Tools & Setup' })).toBeFocused();
    await expect(code).toHaveAttribute('type', 'password');
    await code.fill('incorrect-code');
    await page.getByRole('button', { name: 'Show AI access code' }).click();
    await expect(code).toHaveAttribute('type', 'text');
    await save.click();
    await signal.click();
    await draft.click();
    await expect(page.getByText('AI access code rejected. Enter a valid access code in Setup.').first()).toBeVisible();
    await expect(draft).toBeDisabled();
    await setup.click();
    await expect(page.getByRole('heading', { name: 'Tools & Setup' })).toBeFocused();
    await code.fill('fictional-code-€');
    await save.click();
    await page.reload();
    await expect(code).toHaveValue('fictional-code-€');
    await expect(code).toHaveAttribute('type', 'password');
    await signal.click();
    await draft.click();
    await expect(page.getByRole('textbox', { name: 'AI gap notes result' })).toHaveValue('Northwind draft');
  });

  test('a posted post can generate AI text but cannot apply it as a draft', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('niall-search-os.ai-access-code', 'fictional-code'));
    await page.route('**/api/ai', route => route.fulfill({
      json: route.request().method() === 'GET'
        ? { enabled: true, accessCodeRequired: true, reason: '' }
        : { draft: 'Northwind draft' },
    }));
    await page.goto('/#engage');
    await page.getByRole('button', { name: 'Add post' }).click();
    await page.getByLabel('Post text', { exact: true }).fill('Fabrikam post');
    await page.getByRole('button', { name: 'AI post draft', exact: true }).click();
    const useDraft = page.getByRole('button', { name: 'Use draft', exact: true });
    await expect(useDraft).toBeVisible();
    await page.getByRole('button', { name: 'Approve post' }).click();
    await page.getByRole('button', { name: 'Mark posted' }).click();
    await expect(page.getByText(/^Posted \d{4}-\d{2}-\d{2}$/)).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'AI post draft result', exact: true })).toHaveValue('Northwind draft');
    await expect(page.getByLabel('Post text', { exact: true })).toHaveValue('Fabrikam post');
    await expect(useDraft).toHaveCount(0);
  });
});

test('an offer with bonus exactly at each guardrail qualifies', async ({ page }) => {
  const backup = initialBackup();
  backup.settings.floor = '115';
  backup.settings.compTarget = '230';
  backup.offers = [{ name: 'Northwind', base: '100', bonus: '15' }, { name: 'Fabrikam', base: '200', bonus: '15' }];
  await page.goto('/#setup');
  page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('Import JSON backup').setInputFiles({
    name: 'workspace.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.getByText('Backup imported.')).toBeVisible();
  await page.getByRole('link', { name: 'Convert', exact: true }).click();
  await expect(page.locator('.counter').filter({ hasText: 'Northwind' })).toContainText('Meets floor');
  await expect(page.locator('.counter').filter({ hasText: 'Fabrikam' })).toContainText('Meets target');
});

test('built PWA has a manifest, controls the page and reloads offline', async ({ page, context, browserName }) => {
  await page.goto('/#setup');
  const manifest = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifest).toBeTruthy();
  const response = await context.request.get(manifest!);
  expect(await response.json()).toMatchObject({ name: 'Niall Search OS', display: 'standalone', start_url: '/', icons: expect.arrayContaining([
    expect.objectContaining({ sizes: '192x192' }), expect.objectContaining({ sizes: '512x512' }),
  ]) });
  await page.getByLabel('Positioning', { exact: true }).fill('Northwind offline');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  if (browserName === 'chromium') {
    const protocol = await context.newCDPSession(page);
    const { installabilityErrors } = await protocol.send('Page.getInstallabilityErrors');
    expect(installabilityErrors).toEqual([]);
  }
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByLabel('Positioning', { exact: true })).toHaveValue('Northwind offline');
  await page.getByRole('link', { name: 'Map', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Target companies' })).toBeVisible();
});
