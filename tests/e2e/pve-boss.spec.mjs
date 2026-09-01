import { test, expect } from '@playwright/test';
import { openDex } from './helpers.mjs';

function desktopOnly(page) {
  test.skip(page.viewportSize().width <= 760, 'desktop boss-analysis regression');
}

function mobileOnly(page) {
  test.skip(page.viewportSize().width > 760, '390px boss-analysis regression');
}

async function openBossAnalysis(page) {
  const opened = await openDex(page, '384:normal');
  await page.locator('#openBossAnalysis').click();
  await expect(page.locator('#bossDialog')).toBeVisible();
  await expect(page.locator('#bossSpecies option[value="384:normal"]')).toBeAttached();
  return opened;
}

async function selectRayquaza(page) {
  await page.locator('#bossSearch').fill('레쿠쟈');
  expect(await page.locator('#bossSpecies option').count()).toBeGreaterThanOrEqual(2);
  await expect(page.locator('#bossSpecies option[value="384:normal"]')).toContainText('레쿠쟈');
  await expect(page.locator('#bossSpecies option[value="384:normal|mega:rayquaza_mega"]')).toContainText('메가레쿠쟈');
  await page.locator('#bossSpecies').selectOption('384:normal');
  await expect(page.locator('#bossSpecies')).toHaveValue('384:normal');
}

async function runAnalysis(page) {
  await page.locator('#runBossAnalysis').click();
  await expect(page.locator('#bossResults .boss-result-card').first()).toBeVisible();
  await expect(page.locator('.boss-output')).toHaveAttribute('aria-busy', 'false');
}

async function resultMetric(page, attackerKey, attribute) {
  const selector = attackerKey
    ? `.boss-result-card[data-attacker-key="${attackerKey}"]`
    : '.boss-result-card';
  const card = page.locator(`#bossResults ${selector}`).first();
  await expect(card).toBeVisible();
  const value = Number(await card.getAttribute(attribute));
  expect(Number.isFinite(value), `${attribute} should be a finite number`).toBe(true);
  return { card, value };
}

async function seedOwnedAttacker(page, fixture) {
  await page.waitForFunction(() => Boolean(state.collection.repo) || Boolean(state.collection.error));
  expect(await page.evaluate(() => state.collection.error)).toBe('');
  return page.evaluate(async entry => {
    const pokemon = state.byKey.get(entry.speciesKey);
    const record = ValueDexCollection.createRecordFromState(pokemon, {
      condition: entry.status || 'normal',
      ivs: entry.ivs,
      level: entry.level,
      apex: Boolean(entry.apex)
    }, {
      nickname: entry.nickname,
      moves: entry.moves,
      maxKind: 'none',
      favorite: false,
      tags: ['레이드'],
      note: ''
    });
    await state.collection.repo.add(record);
    if (entry.refresh !== false) await refreshCollection();
    return record.id;
  }, fixture);
}

test('labels generation filters with their regions and analyzes Rayquaza as an exact form', async ({ page }) => {
  desktopOnly(page);
  await openBossAnalysis(page);

  await expect(page.locator('#generationFilter option[value="1"]')).toHaveText('1세대 (관동)');
  await expect(page.locator('#generationFilter option[value="2"]')).toHaveText('2세대 (성도)');
  await expect(page.locator('#generationFilter option[value="9"]')).toHaveText('9세대 (팔데아)');

  await selectRayquaza(page);
  await runAnalysis(page);

  await expect(page.locator('#bossSummary')).toContainText('레쿠쟈');
  await expect(page.locator('#bossSummary')).toContainText('×2.56');
  await expect(page.locator('#bossSummary')).toContainText('얼음');
  expect(Number(await page.locator('#bossResults .boss-result-card').first().getAttribute('data-effectiveness')))
    .toBeCloseTo(2.56, 10);
});

test('applies snowy weather to the same Rayquaza counter DPS', async ({ page }) => {
  desktopOnly(page);
  await openBossAnalysis(page);
  await selectRayquaza(page);
  await page.locator('#bossWeather').selectOption('none');
  await runAnalysis(page);

  const firstCard = page.locator('#bossResults .boss-result-card').first();
  const attackerKey = await firstCard.getAttribute('data-attacker-key');
  expect(attackerKey).toBeTruthy();
  const neutralDps = Number(await firstCard.getAttribute('data-dps'));
  expect(Number.isFinite(neutralDps)).toBe(true);
  expect(Number(await firstCard.getAttribute('data-effectiveness'))).toBeCloseTo(2.56, 10);

  await page.locator('#bossWeather').selectOption('snow');
  await runAnalysis(page);
  const snowy = await resultMetric(page, attackerKey, 'data-dps');
  expect(snowy.value).toBeGreaterThan(neutralDps);
  await expect(page.locator('#bossSummary')).toContainText('눈');
});

test('selects an exact Mega boss form with its changed type and raid preset', async ({ page }) => {
  desktopOnly(page);
  await openBossAnalysis(page);
  await page.locator('#bossSearch').fill('메가리자몽X');
  await expect(page.locator('#bossSpecies option')).toHaveCount(1);
  await page.locator('#bossSpecies').selectOption('6:normal|mega:charizard_mega_x');
  await expect(page.locator('#bossTier')).toHaveValue('mega');
  await runAnalysis(page);

  await expect(page.locator('#bossSummary')).toContainText('메가리자몽X');
  await expect(page.locator('#bossSummary')).toContainText('불꽃 · 드래곤');
  await expect(page.locator('#bossSummary')).toContainText('9,000');
});

test('finds Mega forms by standard English names and restores the suggested regular tier', async ({ page }) => {
  desktopOnly(page);
  await openBossAnalysis(page);

  await page.locator('#bossSearch').fill('Mega Charizard X');
  await expect(page.locator('#bossSpecies option[value="6:normal|mega:charizard_mega_x"]')).toHaveCount(1);
  await page.locator('#bossSpecies').selectOption('6:normal|mega:charizard_mega_x');
  await expect(page.locator('#bossTier')).toHaveValue('mega');
  await expect(page.locator('#bossHp')).toHaveValue('9000');

  await page.locator('#bossSearch').fill('Mega Mewtwo Y');
  await expect(page.locator('#bossSpecies option[value="150:normal|mega:mewtwo_mega_y"]')).toHaveCount(1);

  await page.locator('#bossSearch').fill('Mewtwo');
  await page.locator('#bossSpecies').selectOption('150:normal');
  await expect(page.locator('#bossTier')).toHaveValue('tier5');
  await expect(page.locator('#bossHp')).toHaveValue('15000');
});

test('applies a selected ally Mega type per move and discloses the cycle model', async ({ page }) => {
  desktopOnly(page);
  await openBossAnalysis(page);
  await selectRayquaza(page);
  await page.locator('#bossAllyMegaBoost').selectOption('ice');
  await runAnalysis(page);

  await expect(page.locator('#bossSummary')).toContainText('얼음 타입 · 일치 ×1.3 / 그 외 ×1.1');
  await expect(page.locator('#bossSummary')).toContainText('에너지 상한 100과 이월을 반영한 장기 사이클 평균');
  await expect(page.locator('.boss-result-metrics').first()).toContainText('DPS 사이클 추정');
});

test('reflects custom HP and timer assumptions in TTW and required players', async ({ page }) => {
  desktopOnly(page);
  await openBossAnalysis(page);
  await selectRayquaza(page);
  await page.locator('#bossTier').selectOption('tier5');
  await runAnalysis(page);

  const firstCard = page.locator('#bossResults .boss-result-card').first();
  const attackerKey = await firstCard.getAttribute('data-attacker-key');
  expect(attackerKey).toBeTruthy();
  const baselineTtw = Number(await firstCard.getAttribute('data-ttw'));
  const baselinePlayers = Number(await firstCard.getAttribute('data-required-players'));
  expect(Number.isFinite(baselineTtw)).toBe(true);
  expect(Number.isFinite(baselinePlayers)).toBe(true);

  await page.locator('#bossTier').selectOption('custom');
  await page.locator('#bossHp').fill('30000');
  await page.locator('#bossTimer').fill('150');
  await runAnalysis(page);

  const customTtw = await resultMetric(page, attackerKey, 'data-ttw');
  const customPlayers = await resultMetric(page, attackerKey, 'data-required-players');
  expect(customTtw.value).toBeGreaterThan(baselineTtw * 1.9);
  expect(customPlayers.value).toBeGreaterThan(baselinePlayers);
  await expect(page.locator('#bossSummary')).toContainText('30,000');
  await expect(page.locator('#bossSummary')).toContainText('150초');
});

test('normalizes empty and out-of-range custom assumptions to the visible input bounds', async ({ page }) => {
  desktopOnly(page);
  await openBossAnalysis(page);
  await selectRayquaza(page);
  await page.locator('#bossHp').fill('');
  await page.locator('#bossTimer').fill('1');
  await page.locator('#bossCpm').fill('3');
  await runAnalysis(page);

  await expect(page.locator('#bossHp')).toHaveValue('15000');
  await expect(page.locator('#bossTimer')).toHaveValue('30');
  await expect(page.locator('#bossCpm')).toHaveValue('2');
  await expect(page.locator('#bossSummary')).toContainText('15,000 HP');
  await expect(page.locator('#bossSummary')).toContainText('30초');
});

test('states that one specified boss move is insufficient for the expected TDO model', async ({ page }) => {
  desktopOnly(page);
  await openBossAnalysis(page);
  await selectRayquaza(page);
  await page.locator('#bossFastMove').selectOption({index: 1});
  await page.locator('#bossChargedMove').selectOption('');
  await runAnalysis(page);

  await expect(page.locator('#bossResults .boss-result-card').first()).toContainText('보스 기술 일부만 지정 · 예상 TDO 미산출');
  await expect(page.locator('#bossSummary')).toContainText('보스 기술은 둘 다 골라야 예상 TDO에 반영');
});

test('explains the empty local collection instead of showing catalog counters', async ({ page }) => {
  desktopOnly(page);
  await openBossAnalysis(page);
  await selectRayquaza(page);
  await page.locator('#bossUseCollection').check();
  await page.locator('#runBossAnalysis').click();

  await expect(page.locator('#bossResults')).toContainText('보유함에 저장된 포켓몬이 없습니다.');
  await expect(page.locator('#bossResults .boss-result-card')).toHaveCount(0);
  await expect(page.locator('.boss-output')).toHaveAttribute('aria-busy', 'false');
});

test('uses the exact owned form, IVs, level, and stored moves in collection analysis', async ({ page }) => {
  desktopOnly(page);
  await openBossAnalysis(page);
  const recordId = await seedOwnedAttacker(page, {
    speciesKey: '646:white',
    nickname: '화이트큐레무 레이드 1호',
    status: 'normal',
    ivs: { attack: 15, defense: 14, stamina: 13 },
    level: 42.5,
    moves: { fast: 'ICE_FANG', charged: ['BLIZZARD'] }
  });

  await selectRayquaza(page);
  await page.locator('#bossUseCollection').check();
  await runAnalysis(page);

  const ownedCard = page.locator(`#bossResults .boss-result-card[data-attacker-key="record:${recordId}"]`);
  await expect(ownedCard).toHaveCount(1);
  await expect(ownedCard).toContainText('화이트큐레무 레이드 1호');
  await expect(ownedCard).toContainText('큐레무 (화이트큐레무)');
  await expect(ownedCard).toContainText('Lv.42.5 · 15/14/13');
  await expect(ownedCard).toContainText('얼음엄니 + 눈보라');
  await expect(ownedCard).toContainText('저장된 보유 기술');
  await expect(page.locator('#bossResults .boss-result-card')).toHaveCount(1);
});

test('flags an exclusive move in an owned best combination and explains acquisition', async ({ page }) => {
  desktopOnly(page);
  await openBossAnalysis(page);
  const recordId = await seedOwnedAttacker(page, {
    speciesKey: '376:normal',
    nickname: '특별 기술 메타그로스',
    status: 'normal',
    ivs: { attack: 15, defense: 15, stamina: 15 },
    level: 40,
    moves: { fast: 'BULLET_PUNCH', charged: ['METEOR_MASH'] }
  });

  await selectRayquaza(page);
  await page.locator('#bossUseCollection').check();
  await runAnalysis(page);

  const ownedCard = page.locator(`#bossResults .boss-result-card[data-attacker-key="record:${recordId}"]`);
  await expect(ownedCard).toContainText('불릿펀치 + 코멧펀치');
  await expect(ownedCard.locator('.boss-move-access.exclusive')).toHaveText('특별 기술');
  await expect(ownedCard.locator('.boss-move-access.exclusive')).toHaveAttribute('title', '이벤트·특별 진화·대단한 기술머신 · 일반 기술머신으로 배울 수 없음');
  await expect(ownedCard.locator('.boss-move-access-note')).toContainText('일반 기술머신으로 배울 수 없음');
  await expect(ownedCard.locator('.boss-move-access-note')).toContainText('이벤트·특별 진화·대단한 기술머신');
});

test('keeps a stored non-TM move in owned boss analysis and shows its exact route', async ({ page }) => {
  desktopOnly(page);
  await openBossAnalysis(page);
  const recordId = await seedOwnedAttacker(page, {
    speciesKey: '384:normal',
    nickname: '운석 레쿠쟈',
    status: 'normal',
    ivs: { attack: 15, defense: 15, stamina: 15 },
    level: 40,
    moves: { fast: 'AIR_SLASH', charged: ['DRAGON_ASCENT'] }
  });

  await selectRayquaza(page);
  await page.locator('#bossUseCollection').check();
  await runAnalysis(page);

  const ownedCard = page.locator(`#bossResults .boss-result-card[data-attacker-key="record:${recordId}"]`);
  await expect(ownedCard).toHaveCount(1);
  await expect(ownedCard).toContainText('에어슬래시 + 화룡점정');
  await expect(ownedCard).toContainText('저장된 보유 기술');
  await expect(ownedCard.locator('.boss-move-access.exclusive')).toHaveAttribute('data-access-kind', 'special_item');
  await expect(ownedCard.locator('.boss-move-access-note')).toContainText('화룡점정: 운석 사용 · 모든 기술머신으로 배울 수 없음');
});

test('uses supported Shadow status moves without silently replacing the stored move', async ({ page }) => {
  desktopOnly(page);
  await openBossAnalysis(page);
  const recordId = await seedOwnedAttacker(page, {
    speciesKey: '473:normal',
    nickname: '화풀이 맘모꾸리',
    status: 'shadow',
    ivs: { attack: 15, defense: 15, stamina: 15 },
    level: 40,
    moves: { fast: 'POWDER_SNOW', charged: ['FRUSTRATION'] }
  });

  await selectRayquaza(page);
  await page.locator('#bossUseCollection').check();
  await runAnalysis(page);

  const ownedCard = page.locator(`#bossResults .boss-result-card[data-attacker-key="record:${recordId}"]`);
  await expect(ownedCard).toContainText('눈싸라기 + 화풀이');
  await expect(ownedCard).toContainText('저장된 보유 기술');
  await expect(ownedCard.locator('.boss-move-access.status')).toHaveText('상태 전용');
  await expect(ownedCard.locator('.boss-move-access-note')).toContainText('화풀이: 그림자 포켓몬 포획 · 모든 기술머신으로 배울 수 없음');
  await expect(ownedCard).not.toContainText('눈사태');
});

test('keeps a legitimate zero-power fast move in owned PvE analysis', async ({ page }) => {
  desktopOnly(page);
  await openBossAnalysis(page);
  const recordId = await seedOwnedAttacker(page, {
    speciesKey: '289:normal',
    nickname: '하품 게을킹',
    status: 'normal',
    ivs: { attack: 15, defense: 15, stamina: 15 },
    level: 40,
    moves: { fast: 'YAWN', charged: ['PLAY_ROUGH'] }
  });

  await selectRayquaza(page);
  await page.locator('#bossUseCollection').check();
  await runAnalysis(page);

  const ownedCard = page.locator(`#bossResults .boss-result-card[data-attacker-key="record:${recordId}"]`);
  await expect(ownedCard).toContainText('하품 + 치근거리기');
  await expect(ownedCard).toContainText('저장된 보유 기술');
});

test('clears prior result cards when the boss search no longer has a match', async ({ page }) => {
  desktopOnly(page);
  await openBossAnalysis(page);
  await selectRayquaza(page);
  await runAnalysis(page);
  await expect(page.locator('#bossResults .boss-result-card')).not.toHaveCount(0);

  await page.locator('#bossSearch').fill('zzzz-no-match');
  await expect(page.locator('#bossSummary')).toContainText('분석할 보스와 폼을 선택');
  await expect(page.locator('#bossResults .boss-result-card')).toHaveCount(0);
  await expect(page.locator('#bossResults')).toContainText('보스 이름을 다시 검색');
  await expect(page.locator('.boss-output')).toHaveAttribute('aria-busy', 'false');
});

test('excludes an incompatible stored status move instead of substituting an optimal move', async ({ page }) => {
  desktopOnly(page);
  await openBossAnalysis(page);
  await seedOwnedAttacker(page, {
    speciesKey: '473:normal',
    nickname: '상태와 기술이 맞지 않는 기록',
    status: 'normal',
    ivs: { attack: 15, defense: 15, stamina: 15 },
    level: 40,
    moves: { fast: 'POWDER_SNOW', charged: ['FRUSTRATION'] }
  });

  await selectRayquaza(page);
  await page.locator('#bossUseCollection').check();
  await page.locator('#runBossAnalysis').click();

  await expect(page.locator('#bossResults')).toContainText('저장 기술을 현재 데이터로 계산할 수 없는 보유 개체 1마리');
  await expect(page.locator('#bossResults')).toContainText('다른 최적 기술로 임의 대체하지 않았습니다.');
  await expect(page.locator('#bossResults .boss-result-card')).toHaveCount(0);
});

test('refreshes the local collection immediately before analysis', async ({ page }) => {
  desktopOnly(page);
  await openBossAnalysis(page);
  const recordId = await seedOwnedAttacker(page, {
    speciesKey: '646:white',
    nickname: '아직 화면에 갱신하지 않은 개체',
    status: 'normal',
    ivs: { attack: 14, defense: 15, stamina: 15 },
    level: 40,
    moves: { fast: 'ICE_FANG', charged: ['BLIZZARD'] },
    refresh: false
  });
  expect(await page.evaluate(() => state.collection.records.length)).toBe(0);

  await selectRayquaza(page);
  await page.locator('#bossUseCollection').check();
  await runAnalysis(page);

  await expect(page.locator(`#bossResults .boss-result-card[data-attacker-key="record:${recordId}"]`)).toContainText('아직 화면에 갱신하지 않은 개체');
  expect(await page.evaluate(() => state.collection.records.length)).toBe(1);
});

test('prevents a slower prior collection analysis from overwriting newer conditions', async ({ page }) => {
  desktopOnly(page);
  await openBossAnalysis(page);
  await page.evaluate(() => window.ValueDexAppReady);
  await page.evaluate(() => {
    const originalRefresh = window.refreshCollection;
    let calls = 0;
    window.refreshCollection = async (...args) => {
      calls += 1;
      await new Promise(resolve => setTimeout(resolve, calls === 1 ? 300 : 10));
      return originalRefresh(...args);
    };
  });

  await selectRayquaza(page);
  await page.locator('#bossUseCollection').check();
  await page.locator('#bossWeather').selectOption('none');
  await page.locator('#runBossAnalysis').click();
  await page.waitForTimeout(30);
  await page.locator('#bossWeather').selectOption('snow');

  await expect(page.locator('#bossSummary')).toContainText('눈');
  await expect(page.locator('.boss-output')).toHaveAttribute('aria-busy', 'false');
  await page.waitForTimeout(250);
  await expect(page.locator('#bossSummary')).toContainText('눈');
  await expect(page.locator('#bossSummary')).not.toContainText('부스트 없음');
});

test('keeps the boss-analysis dialog touch-friendly without horizontal overflow', async ({ page }) => {
  mobileOnly(page);
  await openDex(page, '384:normal');

  const openerHeight = await page.locator('#openBossAnalysis').evaluate(element => element.getBoundingClientRect().height);
  expect(openerHeight).toBeGreaterThanOrEqual(44);
  expect(await page.locator('#iv-attack').evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await page.locator('#openBossAnalysis').click();
  await expect(page.locator('#bossDialog')).toBeVisible();
  await expect(page.locator('#bossSpecies option[value="384:normal"]')).toBeAttached();

  for (const selector of [
    '#bossSearch',
    '#bossSpecies',
    '#bossTier',
    '#bossWeather',
    '#bossAttackerLevel',
    '#runBossAnalysis',
    '[data-close-dialog="bossDialog"]'
  ]) {
    const height = await page.locator(selector).evaluate(element => element.getBoundingClientRect().height);
    expect(height, `${selector} should expose a 44px touch target`).toBeGreaterThanOrEqual(44);
  }

  expect(await page.locator('#bossDialog').evaluate(dialog => {
    const rect = dialog.getBoundingClientRect();
    return rect.left >= 0
      && rect.right <= window.innerWidth
      && dialog.scrollWidth <= dialog.clientWidth;
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.locator('#bossSearch').fill('레쿠쟈');
  await page.locator('#bossSpecies').selectOption('384:normal');
  await runAnalysis(page);
  for (const selector of ['.boss-summary-grid span', '.boss-result-badges span', '.boss-result-metrics span']) {
    const fontSize = await page.locator(selector).first().evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(fontSize, `${selector} should remain readable`).toBeGreaterThanOrEqual(10);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.locator('#bossDialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
});

test('keeps every primary nav action reachable at the 320px minimum width', async ({ page }) => {
  mobileOnly(page);
  await page.setViewportSize({ width: 320, height: 700 });
  await openDex(page, '384:normal');

  await expect(page.locator('#openBossAnalysis')).toHaveAccessibleName('레이드 보스 분석 열기');
  await expect(page.locator('#openCollection')).toHaveAccessibleName('내 포켓몬 보유함 열기');
  await expect(page.locator('#openGuide')).toHaveAccessibleName('판정 기준 열기');
  const navLayout = await page.evaluate(() => {
    const topbar = document.querySelector('.topbar').getBoundingClientRect();
    const buttons = [...document.querySelectorAll('#openBossAnalysis, #openCollection, #openGuide')]
      .map(element => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, height: rect.height };
      });
    return { topbar: { left: topbar.left, right: topbar.right, top: topbar.top, bottom: topbar.bottom }, buttons };
  });
  for (const button of navLayout.buttons) {
    expect(button.left).toBeGreaterThanOrEqual(navLayout.topbar.left);
    expect(button.right).toBeLessThanOrEqual(navLayout.topbar.right);
    expect(button.top).toBeGreaterThanOrEqual(navLayout.topbar.top);
    expect(button.bottom).toBeLessThanOrEqual(navLayout.topbar.bottom);
    expect(button.height).toBeGreaterThanOrEqual(44);
  }
  for (let index = 1; index < navLayout.buttons.length; index += 1) {
    expect(navLayout.buttons[index - 1].right).toBeLessThanOrEqual(navLayout.buttons[index].left);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.locator('#iv-attack').evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);

  await page.locator('#openGuide').click();
  await expect(page.locator('#guideDialog')).toBeVisible();
  await page.locator('#guideDialog .dialog-close').click();
  await page.locator('#openCollection').click();
  await expect(page.locator('#collectionDialog')).toBeVisible();
  await page.locator('[data-close-dialog="collectionDialog"]').click();
  await page.locator('#openBossAnalysis').click();
  await expect(page.locator('#bossDialog')).toBeVisible();
  await expect(page.locator('#bossAttackerLevel')).toBeVisible();
  expect(await page.locator('#bossAttackerLevel').evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
