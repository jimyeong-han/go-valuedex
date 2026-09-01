import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const Collection = require('../collection.js');

const FIXED_TIME = '2026-09-01T12:34:56.000Z';
const LATER_TIME = '2026-09-02T12:34:56.000Z';

const pokemon = Object.freeze({
  speciesKey: '184:normal',
  shadowEligible: true,
  dynamax: true,
  gigantamax: false,
  moves: {
    fast: [{id: 'BUBBLE'}],
    charged: [{id: 'ICE_BEAM'}, {id: 'PLAY_ROUGH'}]
  }
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeState(overrides = {}) {
  return {
    condition: 'normal',
    ivs: {attack: 0, defense: 15, stamina: 15},
    level: 45.5,
    maxEligible: false,
    apex: false,
    training: {
      capType: 'none',
      silverStat: 'attack',
      target: {attack: 0, defense: 15, stamina: 15},
      goodBuddy: false,
      phase: 'planned'
    },
    ...overrides
  };
}

function makeRecord(options = {}) {
  return Collection.createRecordFromState(pokemon, makeState(options.state), {
    uuid: options.id || 'record-1',
    now: options.now || FIXED_TIME,
    nickname: options.nickname || '',
    moves: options.moves || {fast: 'BUBBLE', charged: ['ICE_BEAM', 'PLAY_ROUGH']},
    maxKind: options.maxKind,
    favorite: options.favorite,
    tags: options.tags || [],
    note: options.note || ''
  });
}

function expectCode(callback, code) {
  assert.throws(callback, error => error && error.code === code);
}

async function expectCodeAsync(callback, code) {
  await assert.rejects(callback, error => error && error.code === code);
}

const tests = [];
function test(name, callback) { tests.push({name, callback}); }

test('exports the stable UMD/CommonJS contract', () => {
  for (const name of [
    'open', 'createRecordFromState', 'recordToSnapshot', 'validateRecord',
    'auditRecord', 'migrateRecord', 'planImport', 'serializeJSON',
    'parseJSON', 'serializeCSV', 'parseCSV'
  ]) assert.equal(typeof Collection[name], 'function', name);
  assert.equal(Collection.RECORD_VERSION, 1);
});

test('creates a canonical record without mutating Pokémon or UI state', () => {
  const state = makeState();
  const stateBefore = clone(state);
  const pokemonBefore = clone(pokemon);
  const record = Collection.createRecordFromState(pokemon, state, {
    uuid: 'azumarill-gl',
    now: FIXED_TIME,
    nickname: '파란 탱커',
    tags: [' 슈퍼리그 ', '교환   금지', '슈퍼리그'],
    note: 'CP 1499'
  });
  assert.deepEqual(state, stateBefore);
  assert.deepEqual(pokemon, pokemonBefore);
  assert.equal(record.nickname, '파란 탱커');
  assert.deepEqual(record.tags, ['슈퍼리그', '교환 금지']);
  assert.equal(record.revision, 1);
  assert.equal(record.max.kind, 'none');
  assert.equal(Collection.validateRecord(record).valid, true);
});

test('validates IV, level, nickname, moves, and unknown fields strictly', () => {
  const invalid = makeRecord();
  invalid.ivs.attack = 16;
  invalid.level = 45.25;
  invalid.nickname = '가'.repeat(41);
  invalid.speciesKey = `1:${'a'.repeat(127)}`;
  invalid.moves.fast = 'A'.repeat(129);
  invalid.moves.charged.push('HYDRO_PUMP');
  invalid.revision = Number.MAX_SAFE_INTEGER + 1;
  invalid.updatedAt = `2026-09-01T12:34:56.${'0'.repeat(50)}Z`;
  invalid.accidental = true;
  const result = Collection.validateRecord(invalid);
  assert.equal(result.valid, false);
  const codes = new Set(result.errors.map(error => error.code));
  for (const code of ['IV_INVALID', 'LEVEL_INVALID', 'NICKNAME_INVALID', 'SPECIES_KEY_INVALID', 'FAST_MOVE_INVALID', 'CHARGED_MOVES_LIMIT', 'REVISION_INVALID', 'UPDATED_AT_INVALID', 'FIELD_UNKNOWN']) assert(codes.has(code), code);
});

test('rejects impossible shadow, Apex, Max, and silver-training combinations', () => {
  const shadowMax = makeRecord({maxKind: 'dynamax'});
  shadowMax.status = 'shadow';
  assert(Collection.validateRecord(shadowMax).errors.some(error => error.code === 'SHADOW_MAX_INVALID'));

  const apex = makeRecord();
  apex.apex = true;
  assert(Collection.validateRecord(apex).errors.some(error => error.code === 'APEX_STATUS_INVALID'));

  const silver = makeRecord();
  silver.hyperTraining = {
    phase: 'planned', capType: 'silver', silverStat: 'attack',
    targetIvs: {attack: 1, defense: 15, stamina: 14}, goodBuddy: true
  };
  assert(Collection.validateRecord(silver).errors.some(error => error.code === 'TRAINING_TARGET_BELOW_CURRENT'));
});

test('migrates a v0 record to v1 immutably and idempotently', () => {
  const legacy = {
    id: 'legacy-1', speciesKey: '184:normal', nickname: '레거시',
    condition: 'normal', attackIv: 0, defenseIv: 15, staminaIv: 15,
    level: 45.5, fastMove: 'BUBBLE', chargedMoves: ['ICE_BEAM'],
    maxEligible: true, favorite: true, tags: [' 슈퍼 '], note: '보존',
    createdAt: FIXED_TIME, updatedAt: FIXED_TIME
  };
  const before = clone(legacy);
  const migrated = Collection.migrateRecord(legacy);
  assert.deepEqual(legacy, before);
  assert.equal(migrated.recordVersion, 1);
  assert.equal(migrated.nickname, '레거시');
  assert.equal(migrated.status, 'normal');
  assert.deepEqual(migrated.ivs, {attack: 0, defense: 15, stamina: 15});
  assert.deepEqual(migrated.moves, {fast: 'BUBBLE', charged: ['ICE_BEAM']});
  assert.equal(migrated.max.kind, 'dynamax');
  assert.deepEqual(migrated.tags, ['슈퍼']);
  assert.deepEqual(Collection.migrateRecord(migrated), migrated);
});

test('rejects future record versions without modifying input', () => {
  const future = {...makeRecord(), recordVersion: 2};
  const before = clone(future);
  expectCode(() => Collection.migrateRecord(future), 'UNSUPPORTED_FUTURE_VERSION');
  assert.deepEqual(future, before);
});

test('converts planned and completed Hyper Training into correct snapshots', () => {
  const record = makeRecord();
  record.hyperTraining = {
    phase: 'planned', capType: 'gold', silverStat: null,
    targetIvs: {attack: 15, defense: 15, stamina: 15}, goodBuddy: true
  };
  assert.equal(Collection.validateRecord(record).valid, true);
  assert.deepEqual(Collection.recordToSnapshot(record).ivs, record.ivs);
  assert.deepEqual(Collection.recordToSnapshot(record, {training: 'target'}).ivs, record.hyperTraining.targetIvs);
  record.hyperTraining.phase = 'completed';
  assert.deepEqual(Collection.recordToSnapshot(record).ivs, record.hyperTraining.targetIvs);
  assert.equal(Collection.recordToSnapshot(record).maxEligible, false);
});

test('audits current-catalog mismatches as warnings without deleting records', () => {
  const unknown = makeRecord();
  unknown.speciesKey = '9999:future';
  const missing = Collection.auditRecord(unknown, new Map(), new Map());
  assert(missing.warnings.some(warning => warning.code === 'SPECIES_NOT_FOUND'));
  assert.equal(unknown.speciesKey, '9999:future');

  const mismatch = makeRecord({maxKind: 'dynamax'});
  mismatch.moves.fast = 'LEGACY_FAST';
  const audit = Collection.auditRecord(
    mismatch,
    new Map([[pokemon.speciesKey, {...pokemon, dynamax: false}]]),
    new Map([['LEGACY_FAST', {id: 'LEGACY_FAST'}]])
  );
  assert(audit.warnings.some(warning => warning.code === 'DYNAMAX_NOT_SUPPORTED'));
  assert(audit.warnings.some(warning => warning.code === 'FAST_MOVE_NOT_IN_POOL'));
});

test('round-trips every field through versioned JSON with Unicode and integrity', async () => {
  const record = makeRecord({
    nickname: '파랑이✨',
    favorite: true,
    tags: ['슈퍼리그', '친구 교환'],
    note: '=SUM(A1:A2), "따옴표"\n둘째 줄 😀'
  });
  const text = await Collection.serializeJSON([record], {
    appVersion: '1.4.0-test',
    dataSnapshots: {pokemonGeneratedAt: FIXED_TIME}
  }, {now: LATER_TIME});
  const parsed = await Collection.parseJSON(text);
  assert.deepEqual(parsed.records, [record]);
  assert.equal(parsed.metadata.appVersion, '1.4.0-test');
  assert.equal(parsed.metadata.dataSnapshots.pokemonGeneratedAt, FIXED_TIME);
});

test('uses the current app version when export metadata is omitted', async () => {
  const text = await Collection.serializeJSON([makeRecord()], {}, {now: LATER_TIME});
  assert.equal(JSON.parse(text).appVersion, '1.5.0');
});

test('detects JSON mutation before importing records', async () => {
  const text = await Collection.serializeJSON([makeRecord({note: '원본'})], {}, {now: LATER_TIME});
  const envelope = JSON.parse(text);
  envelope.records[0].note = '변조';
  await expectCodeAsync(() => Collection.parseJSON(JSON.stringify(envelope)), 'INTEGRITY_MISMATCH');
});

test('migrates a legacy JSON array and supplies v1 defaults', async () => {
  const legacy = {
    id: 'legacy-json', speciesKey: '184:normal', condition: 'normal',
    ivs: {attack: 1, defense: 14, stamina: 15}, level: 40,
    fastMove: null, chargedMoves: [], createdAt: FIXED_TIME, updatedAt: FIXED_TIME
  };
  const parsed = await Collection.parseJSON(JSON.stringify([legacy]));
  assert.equal(parsed.records[0].recordVersion, 1);
  assert.equal(parsed.records[0].nickname, '');
  assert.deepEqual(parsed.records[0].tags, []);
});

test('rejects duplicate IDs before JSON export', async () => {
  const record = makeRecord();
  await expectCodeAsync(() => Collection.serializeJSON([record, clone(record)]), 'DUPLICATE_ID');
});

test('round-trips commas, quotes, CRLF, emoji, nickname, tags, and plans through CSV', () => {
  const record = makeRecord({
    nickname: '별명, "A"',
    tags: ['리그,용', '한글'],
    note: '=HYPERLINK("bad")\r\n둘째 줄 😀'
  });
  record.hyperTraining = {
    phase: 'planned', capType: 'silver', silverStat: 'attack',
    targetIvs: {attack: 1, defense: 15, stamina: 15}, goodBuddy: false
  };
  assert.equal(Collection.validateRecord(record).valid, true);
  const csv = Collection.serializeCSV([record]);
  assert(csv.startsWith('"format","formatVersion"'));
  const parsed = Collection.parseCSV(csv);
  assert.deepEqual(parsed.records, [record]);
});

test('rejects malformed CSV headers and JSON cells', () => {
  expectCode(() => Collection.parseCSV('wrong,header\r\n'), 'CSV_HEADER_INVALID');
  const csv = Collection.serializeCSV([makeRecord({tags: ['태그']})]);
  const corrupted = csv.replace('[""태그""]', '[not-json]');
  expectCode(() => Collection.parseCSV(corrupted), 'CSV_JSON_CELL_INVALID');
});

test('merges by stable ID using newer timestamp and revision without mutating inputs', () => {
  const existing = makeRecord({id: 'same', note: '기존'});
  const incoming = {...clone(existing), revision: 2, note: '새 값', updatedAt: LATER_TIME};
  const existingBefore = clone(existing);
  const incomingBefore = clone(incoming);
  const plan = Collection.planImport([existing], [incoming], {mode: 'merge', conflict: 'newer'});
  assert.equal(plan.records[0].note, '새 값');
  assert.deepEqual(plan.report, {
    mode: 'merge', added: 0, updated: 1, skipped: 0, removed: 0,
    conflicts: [{id: 'same', existingRevision: 1, incomingRevision: 2}]
  });
  assert.deepEqual(existing, existingBefore);
  assert.deepEqual(incoming, incomingBefore);
});

test('supports merge skip/error and atomic replace plans', () => {
  const existing = makeRecord({id: 'same', note: '기존'});
  const incoming = {...clone(existing), revision: 2, note: '새 값', updatedAt: LATER_TIME};
  const skipped = Collection.planImport([existing], [incoming], {conflict: 'skip'});
  assert.equal(skipped.records[0].note, '기존');
  assert.equal(skipped.report.skipped, 1);
  expectCode(() => Collection.planImport([existing], [incoming], {conflict: 'error'}), 'IMPORT_CONFLICT');
  const replacement = makeRecord({id: 'replacement'});
  const replaced = Collection.planImport([existing], [replacement], {mode: 'replace'});
  assert.deepEqual(replaced.records, [replacement]);
  assert.equal(replaced.report.removed, 1);
});

test('prefers monotonic revision over a skewed future wall clock during merge', () => {
  const existing = {...makeRecord({id: 'clock-skew', note: 'revision wins'}), revision: 3};
  const incoming = {...clone(existing), revision: 2, note: 'future clock', updatedAt: '2099-01-01T00:00:00.000Z'};
  const plan = Collection.planImport([existing], [incoming], {mode: 'merge', conflict: 'newer'});
  assert.equal(plan.records[0].note, 'revision wins');
  assert.equal(plan.report.skipped, 1);

  const sameRevision = {...clone(existing), note: 'later import', updatedAt: LATER_TIME};
  const replaced = Collection.planImport([existing], [sameRevision], {mode: 'merge', conflict: 'newer'});
  assert.equal(replaced.records[0].note, 'later import');
  assert.equal(replaced.records[0].revision, 4);
});

test('enforces import size and record-count limits before writes', async () => {
  await expectCodeAsync(() => Collection.parseJSON(' '.repeat(100), {maxBytes: 10}), 'IMPORT_SIZE_EXCEEDED');
  expectCode(() => Collection.serializeCSV([makeRecord()], {}, {maxRecords: 0}), 'RECORD_LIMIT_EXCEEDED');
  expectCode(() => Collection.planImport(
    [makeRecord({id: 'existing-at-limit'})],
    [makeRecord({id: 'incoming-over-limit'})],
    {mode: 'merge', maxRecords: 1}
  ), 'RECORD_LIMIT_EXCEEDED');

  const largeRecords = Array.from({length: 5000}, (_value, index) => makeRecord({id: `large-${index}`, note: 'x'.repeat(2000)}));
  const json = await Collection.serializeJSON(largeRecords, {}, {pretty: false, now: LATER_TIME});
  assert(Buffer.byteLength(json, 'utf8') > 10 * 1024 * 1024);
  assert.equal((await Collection.parseJSON(json)).records.length, largeRecords.length);
  const csv = Collection.serializeCSV(largeRecords);
  assert(Buffer.byteLength(csv, 'utf8') > 10 * 1024 * 1024);
  assert.equal(Collection.parseCSV(csv).records.length, largeRecords.length);

  const newlineBomb = `${Collection.CSV_HEADERS.map(value => `"${value}"`).join(',')}\r\n${'\r\n'.repeat(10002)}`;
  expectCode(() => Collection.parseCSV(newlineBomb), 'RECORD_LIMIT_EXCEEDED');
});

let passed = 0;
for (const {name, callback} of tests) {
  try {
    await callback();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}
console.log(`\n${passed}/${tests.length} collection tests passed`);
