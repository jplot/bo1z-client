import { expect } from '@playwright/test';
import { enter, paused, running, test } from './fixtures.mjs';

test('Échap met une partie solo en pause', async ({ player }) => {
  await enter(player, '/bo1z/nacht');
  await running(player);
  await player.keyboard.press('Escape');
  await expect.poll(() => paused(player), { timeout: 5000 }).toBe('1');
});

test('dans un salon, Échap ouvre le menu sans arrêter la partie', async ({ player }) => {
  await enter(player, '/bo1z/nacht?room=PZTK');
  await running(player);
  await player.keyboard.press('Escape');
  await player.waitForTimeout(1500);
  expect(await paused(player)).toBe('0');
});
