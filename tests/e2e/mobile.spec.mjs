import { test, expect } from '@playwright/test';
import { openDex, selectSpecies, setIvsAndLevel, setRange } from './helpers.mjs';

test('keeps the 390px detail, status controls, and training planner usable', async ({ page }) => {
  await openDex(page, '184:normal');
  await setIvsAndLevel(page, { attack: 0, defense: 15, stamina: 15 }, 45.5);
  await page.locator('#trainingPlanner').evaluate(element => { element.open = true; });

  expect(await page.evaluate(() => innerWidth)).toBe(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('.dex-sidebar')).toBeHidden();
  await expect(page.locator('#detailPanel')).toBeVisible();
  expect(await page.locator('[data-condition="normal"]').evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  expect(await page.locator('#trainingPlanner summary').evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);

  await page.locator('#trainingCap').selectOption('gold');
  await page.locator('#trainingBuddy').check();
  await setRange(page, '#training-attack', 1);
  await expect(page.locator('#scenarioCompare')).toContainText('CP 1,499 → 1,512');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('supports mobile utility and Shadow-to-purification decisions', async ({ page }) => {
  await openDex(page, '376:normal');
  await expect(page.locator('.utility-pill')).toHaveText('핵심 실전용');

  await selectSpecies(page, '1:normal');
  await setIvsAndLevel(page, { attack: 10, defense: 10, stamina: 10 }, 20);
  await page.locator('[data-condition="shadow"]').click();
  await expect(page.locator('#scenarioCompare')).toContainText('12/12/12 · Lv.25');
  await expect(page.locator('#transformationGrid')).toContainText('맥스배틀 사용 불가');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
