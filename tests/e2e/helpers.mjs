import { expect } from '@playwright/test';

export const appPath = '/go-valuedex/';

export async function openDex(page, speciesKey = '6:normal') {
  const runtimeErrors = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await page.route(/^https:\/\//, route => route.abort('blockedbyclient'));

  const pokemonResponse = page.waitForResponse(response => response.url().endsWith('/go-valuedex/data/pokemon.json'));
  const pvpResponse = page.waitForResponse(response => response.url().endsWith('/go-valuedex/data/pvp.json'));
  await page.goto(appPath, { waitUntil: 'domcontentloaded' });
  const responses = await Promise.all([pokemonResponse, pvpResponse]);
  expect(responses.map(response => response.status())).toEqual([200, 200]);
  await page.waitForFunction(() => typeof state !== 'undefined' && Boolean(state.selected) && Boolean(document.querySelector('.hero-card h2')));
  await selectSpecies(page, speciesKey);
  await expect(page.locator('.hero-card h2')).toBeVisible();
  return { runtimeErrors, responseUrls: responses.map(response => response.url()) };
}

export async function selectSpecies(page, speciesKey) {
  await page.evaluate(key => selectPokemon(key, false), speciesKey);
  await expect.poll(() => page.evaluate(() => state.selected?.speciesKey)).toBe(speciesKey);
}

export async function setIvsAndLevel(page, ivs, level) {
  await page.evaluate(({ nextIvs, nextLevel }) => {
    state.ivs = { ...nextIvs };
    state.level = nextLevel;
    selectPokemon(state.selected.speciesKey, false);
  }, { nextIvs: ivs, nextLevel: level });
}

export async function setRange(page, selector, value) {
  await page.locator(selector).evaluate((input, nextValue) => {
    input.value = String(nextValue);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
