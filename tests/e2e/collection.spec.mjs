import { test, expect } from '@playwright/test';
import { openDex, selectSpecies, setIvsAndLevel } from './helpers.mjs';

async function openCollectionApp(page, speciesKey = '6:normal') {
  const opened = await openDex(page, speciesKey);
  await page.waitForFunction(() => Boolean(state.collection.repo) || Boolean(state.collection.error));
  expect(await page.evaluate(() => state.collection.error)).toBe('');
  return opened;
}

async function readIndexedDb(page) {
  return page.evaluate(async () => {
    const request = indexedDB.open(ValueDexCollection.DB_NAME);
    const database = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = database.transaction('specimens', 'readonly');
      const recordsRequest = transaction.objectStore('specimens').getAll();
      const records = await new Promise((resolve, reject) => {
        recordsRequest.onsuccess = () => resolve(recordsRequest.result);
        recordsRequest.onerror = () => reject(recordsRequest.error);
      });
      await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
      });
      return records.sort((left, right) => left.id.localeCompare(right.id));
    } finally {
      database.close();
    }
  });
}

async function seedRecords(page, fixtures) {
  await page.evaluate(async entries => {
    for (const fixture of entries) {
      const pokemon = state.byKey.get(fixture.speciesKey);
      const record = ValueDexCollection.createRecordFromState(pokemon, {
        condition: fixture.status || 'normal',
        ivs: fixture.ivs,
        level: fixture.level,
        apex: Boolean(fixture.apex)
      }, {
        nickname: fixture.nickname || '',
        moves: fixture.moves || { fast: null, charged: [] },
        maxKind: fixture.maxKind || 'none',
        hyperTraining: fixture.hyperTraining || null,
        favorite: Boolean(fixture.favorite),
        tags: fixture.tags || [],
        note: fixture.note || ''
      });
      await state.collection.repo.add(record);
    }
    await refreshCollection();
  }, fixtures);
}

async function downloadBuffer(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function desktopOnly(page) {
  test.skip(page.viewportSize().width <= 760, 'desktop collection regression');
}

function mobileOnly(page) {
  test.skip(page.viewportSize().width > 760, '390px collection regression');
}

test('quick saves once into IndexedDB and survives reload', async ({ page }) => {
  desktopOnly(page);
  await openCollectionApp(page, '1:normal');
  await setIvsAndLevel(page, { attack: 10, defense: 11, stamina: 12 }, 20.5);

  await page.locator('#quickSave').click();
  await expect(page.locator('#collectionCount')).toHaveText('1');
  await expect(page.locator('#appToast')).toContainText('보유함에 저장했습니다');

  const beforeReload = await readIndexedDb(page);
  expect(beforeReload).toHaveLength(1);
  expect(beforeReload[0]).toMatchObject({
    recordVersion: 1,
    revision: 1,
    speciesKey: '1:normal',
    status: 'normal',
    ivs: { attack: 10, defense: 11, stamina: 12 },
    level: 20.5,
    moves: { fast: null, charged: [] },
    max: { kind: 'none' }
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(state.collection.repo) && state.collection.records.length === 1);
  await expect(page.locator('#collectionCount')).toHaveText('1');
  expect(await readIndexedDb(page)).toEqual(beforeReload);
});

test('edits all specimen metadata and filters the saved card', async ({ page }) => {
  desktopOnly(page);
  await openCollectionApp(page, '6:normal');
  await setIvsAndLevel(page, { attack: 15, defense: 14, stamina: 13 }, 40);
  await page.locator('#maxEligible').check();
  await page.locator('#quickSave').click();
  await expect(page.locator('#collectionCount')).toHaveText('1');

  await page.locator('#openCollection').click();
  await expect(page.locator('#collectionDialog')).toBeVisible();
  await page.locator('[data-record-edit]').click();
  await expect(page.locator('#recordDialog')).toBeVisible();

  const note = '서울, 강남 레이드\n"교환 금지" 메모';
  await page.locator('#recordNickname').fill('리자몽 실전 1호');
  await page.locator('#recordFastMove').selectOption('FIRE_SPIN');
  await page.locator('#recordChargedMove1').selectOption('BLAST_BURN');
  await page.locator('#recordChargedMove2').selectOption('DRAGON_CLAW');
  await page.locator('#recordMaxKind').selectOption('gigantamax');
  await page.locator('#recordFavorite').check();
  await page.locator('#recordTags').fill('레이드, 교환 금지');
  await page.locator('#recordNote').fill(note);
  await page.locator('#recordForm button[type="submit"]').click();

  await expect(page.locator('#recordDialog')).toBeHidden();
  await expect(page.locator('#appToast')).toContainText('보유 개체 정보를 저장했습니다');
  const records = await readIndexedDb(page);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    revision: 2,
    nickname: '리자몽 실전 1호',
    moves: { fast: 'FIRE_SPIN', charged: ['BLAST_BURN', 'DRAGON_CLAW'] },
    max: { kind: 'gigantamax' },
    favorite: true,
    tags: ['레이드', '교환 금지'],
    note
  });

  await expect(page.locator('.collection-card')).toContainText('리자몽 실전 1호');
  await expect(page.locator('.collection-card')).toContainText('거다이맥스');
  await page.locator('#collectionFavorite').check();
  await page.locator('#collectionTag').selectOption('레이드');
  await page.locator('#collectionSearch').fill('강남');
  await expect(page.locator('.collection-card')).toHaveCount(1);
  await expect(page.locator('.collection-card')).toContainText('교환 금지');
  await page.locator('#collectionSearch').fill('존재하지 않는 메모');
  await expect(page.locator('.collection-card')).toHaveCount(0);
  await expect(page.locator('#collectionList')).toContainText('필터에 맞는 개체가 없습니다');
});

test('enforces a two-to-four comparison and switches comparison modes', async ({ page }) => {
  desktopOnly(page);
  await openCollectionApp(page, '6:normal');
  await seedRecords(page, [
    { speciesKey: '6:normal', nickname: '리자몽 A', ivs: { attack: 15, defense: 15, stamina: 15 }, level: 40, maxKind: 'gigantamax', moves: { fast: 'FIRE_SPIN', charged: ['BLAST_BURN'] } },
    { speciesKey: '6:normal', nickname: '리자몽 B', ivs: { attack: 14, defense: 15, stamina: 15 }, level: 40, maxKind: 'dynamax', moves: { fast: 'AIR_SLASH', charged: ['DRAGON_CLAW'] } },
    { speciesKey: '6:normal', nickname: '리자몽 C', status: 'shadow', ivs: { attack: 13, defense: 15, stamina: 15 }, level: 40 },
    { speciesKey: '6:normal', nickname: '리자몽 D', status: 'purified', ivs: { attack: 12, defense: 15, stamina: 15 }, level: 40 },
    { speciesKey: '6:normal', nickname: '리자몽 E', ivs: { attack: 11, defense: 15, stamina: 15 }, level: 40 }
  ]);

  await page.locator('#openCollection').click();
  await page.locator('#toggleCompare').click();
  const recordIds = await page.locator('.collection-card').evaluateAll(cards => cards.map(card => card.dataset.recordId));
  expect(recordIds).toHaveLength(5);

  await page.locator(`[data-record-compare="${recordIds[0]}"]`).click();
  await expect(page.locator('#compareSelection')).toHaveText('1/4 선택');
  await expect(page.locator('#openCompare')).toBeDisabled();
  await page.locator(`[data-record-compare="${recordIds[1]}"]`).click();
  await expect(page.locator('#openCompare')).toBeEnabled();
  await page.locator(`[data-record-compare="${recordIds[2]}"]`).click();
  await page.locator(`[data-record-compare="${recordIds[3]}"]`).click();
  await expect(page.locator('#compareSelection')).toHaveText('4/4 선택');

  await page.locator(`[data-record-compare="${recordIds[4]}"]`).click();
  await expect(page.locator('#compareSelection')).toHaveText('4/4 선택');
  await expect(page.locator('#appToast')).toContainText('최대 4마리');

  await page.locator('#openCompare').click();
  await expect(page.locator('#compareDialog')).toBeVisible();
  await expect(page.locator('#compareTable thead th')).toHaveCount(5);
  await expect(page.locator('#compareTable')).toContainText('동종 IV 순위');

  await page.locator('[data-compare-mode="pve"]').click();
  await expect(page.locator('[data-compare-mode="pve"]')).toHaveClass(/active/);
  await expect(page.locator('#compareTable')).toContainText('중립 화력 지수');
  await expect(page.locator('#compareTable')).toContainText('보유 기술 화력');
  await page.locator('[data-compare-mode="max"]').click();
  await expect(page.locator('[data-compare-mode="max"]')).toHaveClass(/active/);
  await expect(page.locator('#compareTable')).toContainText('Max 자격');
  await expect(page.locator('#compareTable')).toContainText('Max 공격 기준');
  await expect(page.locator('#compareTable')).toContainText('비행 · 에어슬래시');
  await page.locator('[data-compare-mode="mega"]').click();
  await expect(page.locator('#compareTable')).toContainText('Mega 가능');
});

test('round-trips a JSON download and rejects an invalid JSON atomically', async ({ page }) => {
  desktopOnly(page);
  await openCollectionApp(page, '6:normal');
  await seedRecords(page, [
    {
      speciesKey: '6:normal', nickname: '백업 리자몽', ivs: { attack: 15, defense: 14, stamina: 13 }, level: 40,
      maxKind: 'gigantamax', favorite: true, moves: { fast: 'FIRE_SPIN', charged: ['BLAST_BURN', 'DRAGON_CLAW'] },
      tags: ['레이드', '교환 금지'], note: '서울, 강남\n"원본" 메모'
    },
    { speciesKey: '184:normal', nickname: '백업 마릴리', ivs: { attack: 0, defense: 15, stamina: 15 }, level: 45.5, tags: ['슈퍼리그'] }
  ]);
  const original = await readIndexedDb(page);

  await page.locator('#openCollection').click();
  await page.locator('.backup-menu summary').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportCollectionJson').click();
  const backup = await downloadBuffer(await downloadPromise);
  const envelope = JSON.parse(backup.toString('utf8'));
  expect(envelope).toMatchObject({ format: 'go-valuedex-collection', formatVersion: 1, recordCount: 2 });
  expect(envelope.records.sort((left, right) => left.id.localeCompare(right.id))).toEqual(original);

  page.once('dialog', dialog => dialog.accept());
  await page.locator('#clearCollection').click();
  await expect(page.locator('#collectionCount')).toHaveText('0');
  expect(await readIndexedDb(page)).toEqual([]);

  await page.locator('#collectionFile').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: backup });
  await expect(page.locator('#appToast')).toContainText('가져오기 완료');
  await expect(page.locator('#collectionCount')).toHaveText('2');
  expect(await readIndexedDb(page)).toEqual(original);

  const beforeInvalidImport = await readIndexedDb(page);
  await page.locator('#collectionFile').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"format":"go-valuedex-collection","records":[', 'utf8')
  });
  await expect(page.locator('#appToast')).toContainText('파일을 적용하지 않았습니다');
  expect(await readIndexedDb(page)).toEqual(beforeInvalidImport);
});

test('round-trips rich specimen fields through the CSV download and import UI', async ({ page }) => {
  desktopOnly(page);
  await openCollectionApp(page, '6:normal');
  const note = '서울, 강남 원정\n"교환 금지", 레이드 메모';
  await seedRecords(page, [{
    speciesKey: '6:normal',
    nickname: 'CSV, 리자몽 "A"',
    ivs: { attack: 15, defense: 14, stamina: 13 },
    level: 40,
    maxKind: 'gigantamax',
    favorite: true,
    moves: { fast: 'FIRE_SPIN', charged: ['BLAST_BURN', 'DRAGON_CLAW'] },
    tags: ['레이드, 원정', '교환 금지'],
    note
  }]);
  const original = await readIndexedDb(page);

  await page.locator('#openCollection').click();
  await page.locator('.backup-menu summary').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportCollectionCsv').click();
  const backup = await downloadBuffer(await downloadPromise);
  const csv = backup.toString('utf8');
  expect(csv).toContain('go-valuedex-collection');
  expect(csv).toContain('FIRE_SPIN');
  expect(csv).toContain('BLAST_BURN');
  expect(csv).toContain('서울, 강남 원정');

  page.once('dialog', dialog => dialog.accept());
  await page.locator('#clearCollection').click();
  await expect(page.locator('#collectionCount')).toHaveText('0');
  expect(await readIndexedDb(page)).toEqual([]);

  await page.locator('#collectionFile').setInputFiles({ name: 'backup.csv', mimeType: 'text/csv', buffer: backup });
  await expect(page.locator('#appToast')).toContainText('가져오기 완료');
  await expect(page.locator('#collectionCount')).toHaveText('1');
  expect(await readIndexedDb(page)).toEqual(original);
  expect((await readIndexedDb(page))[0]).toMatchObject({
    nickname: 'CSV, 리자몽 "A"',
    moves: { fast: 'FIRE_SPIN', charged: ['BLAST_BURN', 'DRAGON_CLAW'] },
    tags: ['레이드, 원정', '교환 금지'],
    note
  });
});

test('loads a saved card back into the Pokédex without losing the selected league', async ({ page }) => {
  desktopOnly(page);
  await openCollectionApp(page, '6:normal');
  await page.locator('[data-mode="ultra"]').click();
  await seedRecords(page, [{
    speciesKey: '6:normal',
    nickname: '불러오기 회귀',
    status: 'purified',
    ivs: { attack: 14, defense: 13, stamina: 15 },
    level: 32.5,
    maxKind: 'gigantamax'
  }]);

  await page.locator('#openCollection').click();
  await page.locator('[data-record-open]').click();
  await expect(page.locator('#collectionDialog')).toBeHidden();
  expect(await page.evaluate(() => ({
    speciesKey: state.selected.speciesKey,
    status: state.condition,
    ivs: state.ivs,
    level: state.level,
    maxEligible: state.maxEligible,
    mode: state.mode
  }))).toEqual({
    speciesKey: '6:normal',
    status: 'purified',
    ivs: { attack: 14, defense: 13, stamina: 15 },
    level: 32.5,
    maxEligible: true,
    mode: 'ultra'
  });
  await expect(page.locator('[data-condition="purified"]')).toHaveClass(/active/);
  await expect(page.locator('#maxEligible')).toBeChecked();
  await expect(page.locator('[data-mode="ultra"]')).toHaveClass(/active/);
  await expect(page.locator('#ivResult h4')).toContainText('하이퍼리그');
});

test('uses completed Hyper Training targets for evaluation while quick save preserves the base IV plan', async ({ page }) => {
  desktopOnly(page);
  await openCollectionApp(page, '184:normal');
  const baseIvs = { attack: 0, defense: 15, stamina: 15 };
  const targetIvs = { attack: 1, defense: 15, stamina: 15 };
  const hyperTraining = {
    phase: 'completed',
    capType: 'gold',
    silverStat: null,
    targetIvs,
    goodBuddy: true
  };
  await seedRecords(page, [{
    speciesKey: '184:normal',
    nickname: '특훈 완료 원본',
    ivs: baseIvs,
    level: 45.5,
    hyperTraining
  }]);

  await page.locator('#openCollection').click();
  await page.locator('[data-record-open]').click();
  expect(await page.evaluate(() => ({
    ivs: state.ivs,
    training: state.training,
    effectiveIvs: effectiveStateSnapshot().ivs
  }))).toEqual({
    ivs: baseIvs,
    training: {
      phase: 'completed',
      capType: 'gold',
      silverStat: 'attack',
      target: targetIvs,
      goodBuddy: true
    },
    effectiveIvs: targetIvs
  });
  await expect(page.locator('#appraisalPercent')).toHaveText('31/45 · 68.9%');
  await expect(page.locator('#scenarioCompare')).toContainText('대단한 특훈 전후 비교');
  await expect(page.locator('#ivResult .caution')).toContainText('이 형태로는 참가할 수 없습니다');

  await page.locator('#quickSave').click();
  await expect(page.locator('#collectionCount')).toHaveText('2');
  const records = await readIndexedDb(page);
  const quickSaved = records.find(record => record.nickname === '');
  expect(quickSaved).toBeTruthy();
  expect(quickSaved).toMatchObject({
    speciesKey: '184:normal',
    ivs: baseIvs,
    level: 45.5,
    hyperTraining
  });
});

test('keeps a loaded Gigantamax kind when the species also supports Dynamax', async ({ page }) => {
  desktopOnly(page);
  await openCollectionApp(page, '6:normal');
  await seedRecords(page, [{
    speciesKey: '6:normal',
    nickname: '거다이 원본',
    ivs: { attack: 15, defense: 14, stamina: 13 },
    level: 40,
    maxKind: 'gigantamax'
  }]);

  await page.locator('#openCollection').click();
  await page.locator('[data-record-open]').click();
  expect(await page.evaluate(() => ({
    maxEligible: state.maxEligible,
    maxKind: state.maxKind,
    supportsBoth: state.selected.dynamax && state.selected.gigantamax
  }))).toEqual({ maxEligible: true, maxKind: 'gigantamax', supportsBoth: true });
  await expect(page.locator('#maxEligible')).toBeChecked();
  await expect(page.locator('#maxKindInput')).toBeVisible();
  await expect(page.locator('#maxKindInput')).toHaveValue('gigantamax');

  await page.locator('#quickSave').click();
  await expect(page.locator('#collectionCount')).toHaveText('2');
  const records = await readIndexedDb(page);
  const quickSaved = records.find(record => record.nickname === '');
  expect(quickSaved).toBeTruthy();
  expect(quickSaved.max).toEqual({ kind: 'gigantamax' });
});

test('refuses a stale quick-save undo and refreshes to the latest repository revision', async ({ page }) => {
  desktopOnly(page);
  await openCollectionApp(page, '1:normal');
  await setIvsAndLevel(page, { attack: 10, defense: 11, stamina: 12 }, 20.5);
  await page.locator('#quickSave').click();
  await expect(page.locator('#appToast')).toContainText('보유함에 저장했습니다');
  const [{ id, revision }] = await readIndexedDb(page);
  expect(revision).toBe(1);

  const externallyUpdated = await page.evaluate(async recordId => {
    const current = await state.collection.repo.get(recordId);
    return state.collection.repo.update(recordId, { nickname: '다른 탭에서 수정' }, { expectedRevision: current.revision });
  }, id);
  expect(externallyUpdated).toMatchObject({ id, revision: 2, nickname: '다른 탭에서 수정' });
  expect(await page.evaluate(recordId => state.collection.records.find(record => record.id === recordId)?.revision, id)).toBe(1);

  await page.getByRole('button', { name: '실행 취소' }).click();
  await expect(page.locator('#appToast')).toContainText('다른 탭에서 이 기록을 먼저 변경했습니다');
  await expect.poll(() => page.evaluate(recordId => {
    const record = state.collection.records.find(item => item.id === recordId);
    return record && { revision: record.revision, nickname: record.nickname };
  }, id)).toEqual({ revision: 2, nickname: '다른 탭에서 수정' });

  const records = await readIndexedDb(page);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ id, revision: 2, nickname: '다른 탭에서 수정' });
  await page.locator('#openCollection').click();
  await expect(page.locator('.collection-card')).toContainText('다른 탭에서 수정');
});

test('sorts over-cap Great and Ultra specimens last and marks them in comparison', async ({ page }) => {
  desktopOnly(page);
  await openCollectionApp(page, '184:normal');
  const brackets = await page.evaluate(() => {
    const bracket = (speciesKey, cap) => {
      const pokemon = state.byKey.get(speciesKey);
      const ivs = { attack: 15, defense: 15, stamina: 15 };
      let eligible = null;
      for (let level = 1; level <= 50; level += 0.5) {
        const cp = statsAt(pokemon, ivs, level).cp;
        if (cp <= cap) eligible = { level, cp };
        else if (eligible) return { eligible, overCap: { level, cp } };
      }
      throw new Error(`${speciesKey} does not cross CP ${cap}`);
    };
    return {
      great: bracket('184:normal', 1500),
      ultra: bracket('6:normal', 2500)
    };
  });
  await seedRecords(page, [
    { speciesKey: '184:normal', nickname: '슈퍼 참가 가능', ivs: { attack: 15, defense: 15, stamina: 15 }, level: brackets.great.eligible.level },
    { speciesKey: '184:normal', nickname: '슈퍼 CP 초과', ivs: { attack: 15, defense: 15, stamina: 15 }, level: brackets.great.overCap.level },
    { speciesKey: '6:normal', nickname: '하이퍼 참가 가능', ivs: { attack: 15, defense: 15, stamina: 15 }, level: brackets.ultra.eligible.level },
    { speciesKey: '6:normal', nickname: '하이퍼 CP 초과', ivs: { attack: 15, defense: 15, stamina: 15 }, level: brackets.ultra.overCap.level }
  ]);

  await page.locator('#openCollection').click();
  for (const league of [
    { key: 'great', query: '슈퍼', eligible: brackets.great.eligible.cp, overCap: brackets.great.overCap.cp },
    { key: 'ultra', query: '하이퍼', eligible: brackets.ultra.eligible.cp, overCap: brackets.ultra.overCap.cp }
  ]) {
    await page.locator('#collectionSearch').fill(league.query);
    await page.locator('#collectionSort').selectOption(league.key);
    const cards = page.locator('.collection-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText(`${league.query} 참가 가능`);
    await expect(cards.nth(1)).toContainText(`${league.query} CP 초과`);
    await expect(cards.nth(1).locator('.collection-card-metric')).toContainText('현재 CP');
    await expect(cards.nth(1).locator('.collection-card-metric')).toContainText('초과');

    await page.locator('#toggleCompare').click();
    for (const id of await cards.evaluateAll(items => items.map(item => item.dataset.recordId))) {
      await page.locator(`[data-record-compare="${id}"]`).click();
    }
    await page.locator('#openCompare').click();
    await page.locator(`[data-compare-mode="${league.key}"]`).click();
    const participationRow = page.locator('#compareTable tr').filter({ hasText: '현재 참가' });
    await expect(participationRow).toContainText(`가능 · CP ${league.eligible.toLocaleString()}`);
    await expect(participationRow).toContainText(`불가 · CP ${league.overCap.toLocaleString()}`);
    await expect(participationRow).toContainText('초과');

    await page.getByRole('button', { name: '비교 닫기' }).click();
    await page.locator('#cancelCompare').click();
  }
});

test('keeps valid records usable and exports unreadable recovery originals', async ({ page }) => {
  desktopOnly(page);
  await openCollectionApp(page, '1:normal');
  await page.locator('#quickSave').click();
  await expect(page.locator('#collectionCount')).toHaveText('1');

  await page.evaluate(async () => {
    const request = indexedDB.open(ValueDexCollection.DB_NAME);
    const database = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = database.transaction('specimens', 'readwrite');
      const store = transaction.objectStore('specimens');
      store.put({id: 'future-row', recordVersion: 99, marker: '원본 보존'});
      store.put({
        id: '', speciesKey: '1:normal', condition: 'normal',
        ivs: {attack: 1, defense: 2, stamina: 3}, level: 20,
        createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z'
      });
      await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  });

  await page.reload({waitUntil: 'domcontentloaded'});
  await page.waitForFunction(() => Boolean(state.collection.repo) && state.collection.records.length === 2 && state.collection.recovery.length === 1);
  expect(await page.evaluate(() => state.collection.error)).toBe('');
  await page.locator('#openCollection').click();
  await expect(page.locator('.collection-card')).toHaveCount(2);
  await expect(page.locator('#collectionRecoveryWarning')).toBeVisible();
  await expect(page.locator('#collectionRecoveryWarning')).toContainText('1건');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportCollectionRecovery').click();
  const recovery = JSON.parse((await downloadBuffer(await downloadPromise)).toString('utf8'));
  expect(recovery).toMatchObject({format: 'go-valuedex-recovery', formatVersion: 1});
  expect(recovery.entries).toHaveLength(1);
  expect(recovery.entries[0]).toMatchObject({
    id: 'future-row',
    error: {code: 'UNSUPPORTED_FUTURE_VERSION'},
    raw: {id: 'future-row', recordVersion: 99, marker: '원본 보존'}
  });
});

test('keeps quick save and four-way comparison usable without 390px page overflow', async ({ page }) => {
  mobileOnly(page);
  await openCollectionApp(page, '6:normal');
  await setIvsAndLevel(page, { attack: 15, defense: 15, stamina: 15 }, 40);

  expect(await page.locator('#quickSave').evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await page.locator('#quickSave').click();
  await expect(page.locator('#collectionCount')).toHaveText('1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await seedRecords(page, [
    { speciesKey: '6:normal', nickname: '모바일 B', ivs: { attack: 14, defense: 15, stamina: 15 }, level: 40, maxKind: 'dynamax' },
    { speciesKey: '6:normal', nickname: '모바일 C', status: 'shadow', ivs: { attack: 13, defense: 15, stamina: 15 }, level: 40 },
    { speciesKey: '6:normal', nickname: '모바일 D', status: 'purified', ivs: { attack: 12, defense: 15, stamina: 15 }, level: 40 },
    { speciesKey: '6:normal', nickname: '모바일 E', ivs: { attack: 11, defense: 15, stamina: 15 }, level: 40 }
  ]);
  await page.locator('#openCollection').click();
  await expect(page.locator('#collectionDialog')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.locator('#toggleCompare').click();
  const recordIds = await page.locator('.collection-card').evaluateAll(cards => cards.map(card => card.dataset.recordId));
  for (const id of recordIds.slice(0, 4)) await page.locator(`[data-record-compare="${id}"]`).click();
  expect(await page.locator('.compare-check').first().evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  expect(await page.locator('#openCompare').evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await page.locator('#openCompare').click();

  await expect(page.locator('#compareDialog')).toBeVisible();
  expect(await page.locator('[data-compare-mode="pve"]').evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  const tableOverflow = await page.locator('#compareTable').evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  expect(tableOverflow.scroll).toBeGreaterThan(tableOverflow.client);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('[data-compare-mode="pve"]').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
