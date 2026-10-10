import { test as base, chromium, expect } from '@playwright/test';

export const BASE = 'http://127.0.0.1:8630';

// Headed: without a window, Chrome refuses the pointer lock and the click at "Prêt" does not enter the game.
// Profiles kept in .cache/e2e: each map only downloads on the first run.
async function browser(name, use) {
  const context = await chromium.launchPersistentContext(new URL(`../.cache/e2e/${name}`, import.meta.url).pathname,
    { channel: 'chrome', headless: false, viewport: { width: 1280, height: 720 } });
  await use(context.pages()[0] ?? await context.newPage());
  await context.close();
}

export const test = base.extend({
  player: [async ({}, use) => browser('player', use), { scope: 'worker' }],
  guest: [async ({}, use) => browser('guest', use), { scope: 'worker' }],
});

export async function play(page) {
  await page.waitForFunction(() => globalThis.bo1z?.view.screen === 'ready', null, { timeout: 150_000 });
  await page.bringToFront();
  await page.click('.kb-prompt');
  await page.waitForFunction(() => bo1z.view.screen === 'playing' && document.pointerLockElement, null, { timeout: 30_000 });
}

export async function enter(page, path) {
  await page.goto(BASE + path);
  await play(page);
}

export const loadingGone = page => page.waitForFunction(() => document.querySelector('.kb-loading').classList.contains('kb-gone'), null, { timeout: 60_000 });

export async function paused(page) {
  const from = await page.evaluate(() => bo1z.diagnostics.console.length);
  await page.evaluate(() => bo1z.net.command('cl_paused'));
  const line = await page.waitForFunction(from => bo1z.diagnostics.console.slice(from).map(row => row.message).find(message => /"cl_paused"/.test(message)), from);
  return /"cl_paused" is: "(\d)/.exec(await line.jsonValue())?.[1];
}

// The page's intro hold raises cl_paused at the start of the game: wait for it to clear.
export const running = page => expect.poll(() => paused(page), { timeout: 30_000 }).toBe('0');
