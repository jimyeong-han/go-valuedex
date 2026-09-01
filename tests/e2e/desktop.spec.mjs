import { test, expect } from '@playwright/test';
import { appPath, openDex, selectSpecies, setIvsAndLevel, setRange } from './helpers.mjs';

test.describe('GitHub Pages shell and baseline Pokédex regressions', () => {
  test('serves every app dependency from the repository subpath', async ({ page, request, baseURL }) => {
    const { runtimeErrors, responseUrls } = await openDex(page);

    expect(new URL(page.url()).pathname).toBe(appPath);
    expect(responseUrls.map(url => new URL(url).pathname)).toEqual([
      '/go-valuedex/data/pokemon.json',
      '/go-valuedex/data/pvp.json'
    ]);
    expect((await request.get(new URL('/', baseURL).href)).status()).toBe(404);
    expect((await request.get(new URL('mechanics.js', baseURL).href)).status()).toBe(200);
    expect((await request.get(new URL('collection.js', baseURL).href)).status()).toBe(200);
    expect((await request.get(new URL('collection.css', baseURL).href)).status()).toBe(200);
    expect((await request.get(new URL('schemas/pokemon.schema.json', baseURL).href)).status()).toBe(200);
    await expect(page).toHaveTitle('GO ValueDex — Pokémon GO 개체값·실전 도감');
    await expect(page.locator('.sidebar-head h1')).toHaveText('개체값·실전 도감');
    await expect(page.locator('.hero-card h2')).toHaveText('리자몽');
    await expect(page.locator('#detailPanel')).not.toContainText('데이터 로드 실패');
    expect(runtimeErrors).toEqual([]);
  });

  test('keeps form routes, form labels, search, and species-specific moves exact', async ({ page }) => {
    await openDex(page);

    const charizardElite = page.locator('.move-line', { hasText: '블라스트번' }).filter({ has: page.locator('.elite') });
    await expect(charizardElite.first()).toBeVisible();

    await selectSpecies(page, '376:normal');
    await expect(page.locator('.move-line', { hasText: '코멧펀치' }).filter({ has: page.locator('.elite') }).first()).toBeVisible();
    expect(await page.evaluate(() => !moveLine(state.defaultByDex.get(36), 'METEOR_MASH', 'charged', '차지').includes('class="elite"'))).toBe(true);

    await selectSpecies(page, '386:defense');
    await expect(page.locator('.form-chip')).toHaveCount(4);
    expect(await page.evaluate(() => ({
      formCount: state.byDex.get(386).length,
      attack: state.selected.stats.attack,
      defense: state.selected.stats.defense,
      pvpId: state.pvp.leagues.great['386:defense']?.speciesId
    }))).toEqual({ formCount: 4, attack: 144, defense: 330, pvpId: 'deoxys_defense' });

    await page.evaluate(() => navigateTo('487:origin'));
    await expect.poll(() => page.evaluate(() => new URLSearchParams(location.hash.slice(1)).get('pokemon'))).toBe('487:origin');
    await expect(page.locator('.hero-card h2')).toContainText('오리진');

    await page.evaluate(() => selectPokemon(6, false));
    expect(await page.evaluate(() => state.selected.speciesKey)).toBe('6:normal');
    await selectSpecies(page, '19:alola');
    expect(await page.evaluate(() => state.selected.evolutions[0]?.speciesKey)).toBe('20:alola');
    await expect(page.locator('.evo-link[data-select-key="20:alola"]')).toHaveCount(1);

    await selectSpecies(page, '593:normal');
    await expect(page.locator('.form-chip')).toContainText(['수컷', '암컷']);

    await page.locator('#searchInput').fill('어택폼');
    await expect(page.locator('[data-select-key="386:attack"]')).toHaveCount(1);
    await page.locator('#searchInput').fill('뮤츠');
    await expect(page.locator('#resultCount')).toHaveText('1개 폼');
    await expect(page.locator('#pokemonList')).toContainText('뮤츠');
  });

  test('calculates IV appraisal and Max eligibility', async ({ page }) => {
    await openDex(page);
    await expect(page.locator('#ivResult h4')).toContainText('슈퍼리그');

    await setRange(page, '#iv-attack', 15);
    await expect(page.locator('#appraisalPercent')).toContainText('35/45');

    await page.locator('[data-mode="max"]').click();
    await expect(page.locator('#maxToggle')).toBeVisible();
    await expect(page.locator('#ivResult h4')).toContainText('확인');
    await page.locator('#maxEligible').check();
    await expect(page.locator('#ivResult h4')).toContainText('맥스 공격수');

    await selectSpecies(page, '143:normal');
    await page.locator('[data-mode="max"]').click();
    await expect(page.locator('#maxEligible')).toBeEnabled();
    await page.locator('#maxEligible').check();
    await expect(page.locator('#ivResult h4')).not.toContainText('미지원');
    await expect(page.locator('#transformationGrid')).toContainText('거다이맥스');
  });

  test('preserves the selected league in both evolution navigation paths', async ({ page }) => {
    await openDex(page, '1:normal');
    await page.locator('[data-mode="ultra"]').click();
    await expect(page.locator('[data-mode="ultra"]')).toHaveClass(/active/);
    await expect(page.locator('#ivResult h4')).toContainText('하이퍼리그');

    await page.locator('.projection-card[data-select-key="3:normal"]').click();
    await expect.poll(() => page.evaluate(() => state.selected?.speciesKey)).toBe('3:normal');
    expect(await page.evaluate(() => state.mode)).toBe('ultra');
    await expect(page.locator('[data-mode="ultra"]')).toHaveClass(/active/);
    await expect(page.locator('#ivResult h4')).toContainText('하이퍼리그');

    await page.locator('.evo-link[data-select-key="1:normal"]').click();
    await expect.poll(() => page.evaluate(() => state.selected?.speciesKey)).toBe('1:normal');
    expect(await page.evaluate(() => state.mode)).toBe('ultra');

    await page.locator('.evo-link[data-select-key="3:normal"]').click();
    await expect.poll(() => page.evaluate(() => state.selected?.speciesKey)).toBe('3:normal');
    expect(await page.evaluate(() => state.mode)).toBe('ultra');
    await expect(page.locator('[data-mode="ultra"]')).toHaveClass(/active/);
    await expect(page.locator('#ivResult h4')).toContainText('하이퍼리그');
  });
});

test.describe('v1.2 utility and status regressions', () => {
  test('classifies core, conditional, collection, evolution, and reference-only forms', async ({ page }) => {
    await openDex(page, '376:normal');
    await expect(page.locator('.utility-pill')).toHaveText('핵심 실전용');
    await expect(page.locator('.utility-summary')).toContainText('마스터리그');

    await selectSpecies(page, '68:normal');
    await expect(page.locator('.utility-pill')).toHaveText('조건부 실전용');

    await selectSpecies(page, '129:normal');
    await expect(page.locator('.utility-pill')).toHaveText('수집·관상 중심');
    await expect(page.locator('.utility-summary')).toContainText('진화 후 실전 후보');
    await expect(page.locator('.utility-summary')).toContainText('갸라도스');

    await selectSpecies(page, '890:eternamax');
    await expect(page.locator('.utility-pill')).toHaveText('수집·관상 중심');
    await expect(page.locator('.utility-summary')).toContainText('플레이어 보유');
  });

  test('previews Shadow purification and prevents incompatible transformations', async ({ page }) => {
    await openDex(page, '1:normal');
    await setIvsAndLevel(page, { attack: 10, defense: 10, stamina: 10 }, 20);
    await page.locator('[data-condition="shadow"]').click();

    expect(await page.evaluate(() => state.condition)).toBe('shadow');
    const scenario = page.locator('#scenarioCompare');
    await expect(scenario).toContainText('10/10/10 · Lv.20');
    await expect(scenario).toContainText('12/12/12 · Lv.25');
    await expect(scenario).toContainText('590');
    await expect(scenario).toContainText('761');
    await expect(scenario).toContainText('3,000');
    await expect(scenario).toContainText('화풀이');
    await expect(scenario).toContainText('은혜갚기');
    await expect(page.locator('#statusHint')).toContainText('12,000 별의모래 · 사탕 30');
    await expect(page.locator('#transformationGrid')).toContainText('맥스배틀 사용 불가');

    await selectSpecies(page, '249:normal');
    await page.locator('[data-condition="shadow"]').click();
    await page.locator('#apexShadow').check();
    await expect(scenario).toContainText('APEX 정화');
    await expect(scenario).toContainText('5,000');
    await expect(scenario).toContainText('에어로블라스트+');
    await expect(scenario).toContainText('에어로블라스트++');
  });

  test('treats direct Purified IVs as current values and disables ineligible statuses', async ({ page }) => {
    await openDex(page, '1:normal');
    await setIvsAndLevel(page, { attack: 14, defense: 13, stamina: 15 }, 20);
    await page.locator('[data-condition="purified"]').click();

    expect(await page.evaluate(() => state.condition)).toBe('purified');
    await expect(page.locator('#appraisalPercent')).toContainText('42/45');
    await expect(page.locator('#ivResult .explanation')).toContainText('+2');
    await expect(page.locator('#scenarioCompare')).toBeHidden();

    await selectSpecies(page, '386:defense');
    await expect(page.locator('[data-condition="shadow"]')).toBeDisabled();
    await expect(page.locator('[data-condition="purified"]')).toBeDisabled();
  });

  test('previews Gold and Silver Bottle Cap constraints and resets status between species', async ({ page }) => {
    await openDex(page, '184:normal');
    await setIvsAndLevel(page, { attack: 0, defense: 15, stamina: 15 }, 45.5);
    await page.locator('#trainingPlanner summary').click();

    await page.locator('#trainingCap').selectOption('gold');
    await page.locator('#trainingBuddy').check();
    await setRange(page, '#training-attack', 1);
    const scenario = page.locator('#scenarioCompare');
    await expect(scenario).toContainText('0/15/15 · Lv.45.5');
    await expect(scenario).toContainText('1/15/15 · Lv.45.5');
    await expect(scenario).toContainText('CP 1,499 → 1,512');
    await expect(scenario).toContainText('CP 1,500 제한을 넘습니다');
    await expect(page.locator('.training-source')).toContainText('HOME 전송 불가');

    await page.locator('#trainingCap').selectOption('silver');
    await expect(page.locator('#silverStats')).toBeVisible();
    await expect(page.locator('#training-attack')).toBeEnabled();
    await expect(page.locator('#training-defense')).toBeDisabled();
    await expect(page.locator('#training-stamina')).toBeDisabled();

    await selectSpecies(page, '1:normal');
    await page.locator('[data-condition="shadow"]').click();
    await selectSpecies(page, '376:normal');
    expect(await page.evaluate(() => state.condition)).toBe('normal');
    await expect(page.locator('[data-condition="normal"]')).toHaveClass(/active/);
  });
});
