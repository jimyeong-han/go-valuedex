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

test('keeps segmented IV sliders and direct inputs readable at 390px', async ({ page }) => {
  await openDex(page);

  await expect(page.locator('.exclusive-move-note').first()).toContainText('일반 기술머신으로 배울 수 없음');

  const controlMetrics = await page.locator('.iv-stat-slider').evaluateAll(rows => rows.map(row => {
    const range = row.querySelector('[data-iv]');
    const number = row.querySelector('[data-iv-number]');
    const layer = row.querySelector('.iv-range-ticks');
    const layerRect = layer.getBoundingClientRect();
    return {
      key: range.dataset.iv,
      rangeHeight: range.getBoundingClientRect().height,
      numberHeight: number.getBoundingClientRect().height,
      numberInputMode: number.getAttribute('inputmode'),
      ticks: [...layer.querySelectorAll('[data-iv-tick]')].map(tick => {
        const rect = tick.getBoundingClientRect();
        return {
          value: tick.dataset.ivTick,
          height: rect.height,
          ratio: ((rect.left + rect.width / 2) - layerRect.left) / layerRect.width,
          visible: getComputedStyle(tick).visibility !== 'hidden' && getComputedStyle(tick).display !== 'none'
        };
      })
    };
  }));

  expect(controlMetrics.map(metric => metric.key)).toEqual(['attack', 'defense', 'stamina']);
  for (const metric of controlMetrics) {
    expect(metric.rangeHeight).toBeGreaterThanOrEqual(44);
    expect(metric.numberHeight).toBeGreaterThanOrEqual(44);
    expect(metric.numberInputMode).toBe('numeric');
    expect(metric.ticks.map(tick => tick.value)).toEqual(['5', '10']);
    expect(metric.ticks.every(tick => tick.visible && tick.height >= 12)).toBe(true);
    expect(metric.ticks[0].ratio).toBeCloseTo(1 / 3, 2);
    expect(metric.ticks[1].ratio).toBeCloseTo(2 / 3, 2);
  }

  await page.locator('#iv-number-attack').fill('15');
  await expect(page.locator('#iv-attack')).toHaveValue('15');
  expect(await page.evaluate(() => state.ivs.attack)).toBe(15);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
