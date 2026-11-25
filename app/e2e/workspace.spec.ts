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
  expect(JSON.parse(await readFile((await download.path())!, 'utf8'))).toEqual(original);
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
