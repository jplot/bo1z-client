import { expect } from '@playwright/test';
import { BASE, enter, loadingGone, play, test } from './fixtures.mjs';

test('deux joueurs : l’invité entre dans la partie de l’hôte en liaison directe, puis apprend son départ', async ({ player, guest }) => {
  await enter(player, '/nacht?room=QZRT');
  await enter(guest, '/nacht?room=QZRT');
  await loadingGone(guest);
  expect(await player.evaluate(() => kbnet.label)).toBe('10.0.0.1');
  expect(await guest.evaluate(() => ({ label: kbnet.label, linked: kbnet.linked, relayed: Boolean(kbnet.relayed) }))).toEqual({ label: '10.0.0.2', linked: true, relayed: false });
  await player.goto('about:blank');
  await expect(guest.locator('.kb-error-title')).toHaveText('L’hôte a quitté la partie', { timeout: 20_000 });
});

test('salon privé : absent de la liste, rejoint par son code depuis le menu', async ({ player, guest }) => {
  await enter(player, '/kino?room=MZTR&private=1');
  await guest.goto(`${BASE}/`);
  await guest.click('#tab-multi');
  await expect(guest.locator('#rooms')).not.toContainText('MZTR');
  await guest.click('#open-code');
  await guest.keyboard.type('MZTR');
  await guest.click('#join-code');
  await guest.waitForURL(/\/kino\?room=MZTR&private=1$/);
  await play(guest);
  await loadingGone(guest);
  expect(await guest.evaluate(() => ({ label: kbnet.label, linked: kbnet.linked }))).toEqual({ label: '10.0.0.2', linked: true });
});
