import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const mechanics = require('../mechanics.js');

const {
  DEFAULT_CPM,
  appraisalFor,
  speciesStatRetention,
  statsAt,
  bestUnderCap,
  applyStatusModifiers,
  purifiedIvs,
  purifiedLevel,
  buildPurificationPlan,
  buildTrainingPlan
} = mechanics;

const bulbasaur = Object.freeze({
  speciesKey: '1:normal',
  stats: Object.freeze({attack: 118, defense: 111, stamina: 128}),
  shadowEligible: true,
  shadow: Object.freeze({
    purificationStardust: 3000,
    purificationCandy: 3,
    shadowMove: 'FRUSTRATION',
    purifiedMove: 'RETURN',
    rule: 'standard'
  })
});

const azumarill = Object.freeze({
  speciesKey: '184:normal',
  stats: Object.freeze({attack: 112, defense: 152, stamina: 225})
});

const tests = [];

function test(name, callback) {
  tests.push({name, callback});
}

function closeTo(actual, expected, epsilon = 1e-10) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`
  );
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

test('CommonJS API and the complete level 1-50 CPM table are exposed', () => {
  assert.equal(typeof mechanics.statsAt, 'function');
  assert.equal(DEFAULT_CPM.length, 99);
  assert.equal(DEFAULT_CPM[0], 0.094);
  assert.equal(DEFAULT_CPM[89], 0.81779999);
  assert.equal(DEFAULT_CPM[98], 0.84029999);
});

test('appraisalFor clamps IV input and reports normalization reason codes', () => {
  const result = appraisalFor({attack: 99, defense: -2, stamina: 14.6});
  assert.deepEqual(result.ivs, {attack: 15, defense: 0, stamina: 15});
  assert.equal(result.total, 30);
  assert.equal(result.stars, '2★');
  assert.ok(result.reasonCodes.includes('IV_ATTACK_CLAMPED'));
  assert.ok(result.reasonCodes.includes('IV_DEFENSE_CLAMPED'));
  assert.ok(result.reasonCodes.includes('IV_STAMINA_ROUNDED'));
});

test('speciesStatRetention makes the same IV species-specific without redefining IV perfection', () => {
  const ivs = {attack: 10, defense: 10, stamina: 10};
  const bulbasaurRetention = speciesStatRetention(bulbasaur, ivs);
  const mewtwoRetention = speciesStatRetention(
    {stats: {attack: 300, defense: 182, stamina: 214}},
    ivs
  );

  assert.equal(appraisalFor(ivs).percent, 66.66666666666666);
  closeTo(bulbasaurRetention.percent, 89.19000798700047);
  closeTo(mewtwoRetention.percent, 93.8207020888288);
  assert.notEqual(bulbasaurRetention.percent, mewtwoRetention.percent);
});

test('statsAt accepts both a CPM table and a caller CPM function', () => {
  const ivs = {attack: 10, defense: 10, stamina: 10};
  const fromTable = statsAt(bulbasaur, ivs, 20, DEFAULT_CPM);
  let requestedLevel = null;
  const fromFunction = statsAt(bulbasaur, ivs, 20, level => {
    requestedLevel = level;
    return 0.5974;
  });

  assert.equal(requestedLevel, 20);
  assert.equal(fromTable.cp, 590);
  assert.equal(fromFunction.cp, 590);
  assert.equal(fromTable.hp, 82);
  closeTo(fromTable.attack, 76.4672);
  closeTo(fromTable.defense, 72.2854);
});

test('Shadow modifiers raise attack by 20%, lower defense to 5/6, and preserve CP/HP', () => {
  const source = statsAt(bulbasaur, {attack: 10, defense: 10, stamina: 10}, 20);
  const snapshot = structuredClone(source);
  const shadow = applyStatusModifiers(source, 'shadow');

  closeTo(shadow.attack, 91.76064);
  closeTo(shadow.defense, 60.23783333333334);
  assert.equal(shadow.cp, 590);
  assert.equal(shadow.hp, 82);
  assert.deepEqual(source, snapshot);
});

test('purifiedIvs adds two per stat with a hard 15 cap', () => {
  assert.deepEqual(
    purifiedIvs({attack: 14, defense: 13, stamina: 15}),
    {attack: 15, defense: 15, stamina: 15}
  );
  assert.deepEqual(
    purifiedIvs({attack: 99, defense: -2, stamina: 14.6}),
    {attack: 15, defense: 2, stamina: 15}
  );
});

test('purifiedLevel respects current level and the trainer-level floor capped at 25', () => {
  assert.equal(purifiedLevel(20, 50), 25);
  assert.equal(purifiedLevel(30, 50), 30);
  assert.equal(purifiedLevel(8, 20), 20);
});

test('Bulbasaur purification fixture changes L20 10/10/10 CP590 to L25 12/12/12 CP761', () => {
  const plan = buildPurificationPlan({
    pokemon: bulbasaur,
    ivs: {attack: 10, defense: 10, stamina: 10},
    level: 20,
    trainerLevel: 50,
    status: 'shadow'
  });

  assert.equal(plan.valid, true);
  assert.deepEqual(plan.reasonCodes, []);
  assert.equal(plan.current.stats.cp, 590);
  assert.equal(plan.current.battleStats.cp, 590);
  assert.deepEqual(plan.purified.ivs, {attack: 12, defense: 12, stamina: 12});
  assert.equal(plan.purified.level, 25);
  assert.equal(plan.purified.stats.cp, 761);
  assert.deepEqual(plan.cost, {stardust: 3000, candy: 3});
  assert.deepEqual(plan.moves, {shadow: 'FRUSTRATION', purified: 'RETURN'});
});

test('purification reports eligibility and data validation reason codes', () => {
  const notShadow = buildPurificationPlan({
    pokemon: bulbasaur,
    ivs: {attack: 10, defense: 10, stamina: 10},
    level: 20,
    status: 'purified'
  });
  assert.equal(notShadow.valid, false);
  assert.ok(notShadow.reasonCodes.includes('NOT_SHADOW'));

  const missingCosts = buildPurificationPlan({
    pokemon: {stats: bulbasaur.stats, shadowEligible: true},
    ivs: {attack: 10, defense: 10, stamina: 10},
    level: 20,
    status: 'shadow'
  });
  assert.equal(missingCosts.eligible, true);
  assert.equal(missingCosts.valid, false);
  assert.ok(missingCosts.reasonCodes.includes('PURIFICATION_COST_MISSING'));

  const unavailable = buildPurificationPlan({
    pokemon: {stats: bulbasaur.stats, shadowEligible: false},
    ivs: {attack: 10, defense: 10, stamina: 10},
    level: 20,
    status: 'shadow'
  });
  assert.equal(unavailable.eligible, false);
  assert.ok(unavailable.reasonCodes.includes('SHADOW_INELIGIBLE'));
});

test('Gold Bottle Cap plan counts one task per gained IV point', () => {
  const plan = buildTrainingPlan({
    ivs: {attack: 10, defense: 12, stamina: 13},
    target: {attack: 12, defense: 15, stamina: 13},
    status: 'normal',
    capType: 'gold',
    goodBuddy: true,
    phase: 'planned'
  });

  assert.equal(plan.eligible, true);
  assert.equal(plan.valid, true);
  assert.deepEqual(plan.deltas, {attack: 2, defense: 3, stamina: 0});
  assert.deepEqual(plan.tasks, {attack: 2, defense: 3, stamina: 0, total: 5});
  assert.equal(plan.taskCount, 5);
});

test('Silver Bottle Cap accepts only the selected single stat', () => {
  const valid = buildTrainingPlan({
    ivs: {attack: 10, defense: 12, stamina: 13},
    target: {attack: 10, defense: 15, stamina: 13},
    status: 'purified',
    capType: 'silver',
    silverStat: 'defense',
    goodBuddy: true
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.taskCount, 3);

  const multipleStats = buildTrainingPlan({
    ivs: {attack: 10, defense: 12, stamina: 13},
    target: {attack: 12, defense: 15, stamina: 13},
    status: 'normal',
    capType: 'silver',
    silverStat: 'defense',
    goodBuddy: true
  });
  assert.equal(multipleStats.valid, false);
  assert.ok(multipleStats.reasonCodes.includes('SILVER_SINGLE_STAT_ONLY'));

  const lowering = buildTrainingPlan({
    ivs: {attack: 10, defense: 12, stamina: 13},
    target: {attack: 10, defense: 11, stamina: 13},
    status: 'normal',
    capType: 'silver',
    silverStat: 'defense',
    goodBuddy: true
  });
  assert.equal(lowering.valid, false);
  assert.ok(lowering.reasonCodes.includes('TARGET_BELOW_CURRENT'));
});

test('Hyper Training rejects Shadow, perfect, and non-Good-Buddy inputs', () => {
  const shadow = buildTrainingPlan({
    ivs: {attack: 10, defense: 12, stamina: 13},
    target: {attack: 11, defense: 12, stamina: 13},
    status: 'shadow',
    capType: 'gold',
    goodBuddy: true
  });
  assert.equal(shadow.eligible, false);
  assert.ok(shadow.reasonCodes.includes('SHADOW_INELIGIBLE'));

  const perfect = buildTrainingPlan({
    ivs: {attack: 15, defense: 15, stamina: 15},
    target: {attack: 15, defense: 15, stamina: 15},
    status: 'normal',
    capType: 'gold',
    goodBuddy: true
  });
  assert.equal(perfect.eligible, false);
  assert.ok(perfect.reasonCodes.includes('ALREADY_PERFECT'));

  const noBuddy = buildTrainingPlan({
    ivs: {attack: 10, defense: 12, stamina: 13},
    target: {attack: 11, defense: 12, stamina: 13},
    status: 'normal',
    capType: 'gold',
    goodBuddy: false
  });
  assert.equal(noBuddy.eligible, false);
  assert.ok(noBuddy.reasonCodes.includes('GOOD_BUDDY_REQUIRED'));
});

test('Azumarill Great League fixture warns through CP math: 1499 becomes 1512 after +1 attack', () => {
  const before = statsAt(azumarill, {attack: 0, defense: 15, stamina: 15}, 45.5);
  const after = statsAt(azumarill, {attack: 1, defense: 15, stamina: 15}, 45.5);
  const best = bestUnderCap(azumarill, {attack: 0, defense: 15, stamina: 15}, 1500);

  assert.equal(before.cp, 1499);
  assert.equal(after.cp, 1512);
  assert.equal(best.level, 45.5);
  assert.equal(best.cp, 1499);
  assert.ok(before.cp <= 1500 && after.cp > 1500);
});

test('all public calculation and planning functions leave frozen inputs untouched', () => {
  const ivs = deepFreeze({attack: 10, defense: 12, stamina: 13});
  const target = deepFreeze({attack: 12, defense: 15, stamina: 13});
  const statInput = deepFreeze({attack: 100, defense: 90, hp: 120, cp: 1400, product: 1});
  const purificationInput = deepFreeze({
    pokemon: bulbasaur,
    ivs,
    level: 20,
    trainerLevel: 50,
    status: 'shadow'
  });
  const trainingInput = deepFreeze({
    ivs,
    target,
    status: 'normal',
    capType: 'gold',
    goodBuddy: true
  });
  const before = {
    ivs: structuredClone(ivs),
    target: structuredClone(target),
    stats: structuredClone(statInput),
    purification: structuredClone(purificationInput),
    training: structuredClone(trainingInput)
  };

  appraisalFor(ivs);
  statsAt(bulbasaur, ivs, 20);
  bestUnderCap(bulbasaur, ivs, 1500);
  applyStatusModifiers(statInput, 'shadow');
  purifiedIvs(ivs);
  buildPurificationPlan(purificationInput);
  buildTrainingPlan(trainingInput);

  assert.deepEqual(ivs, before.ivs);
  assert.deepEqual(target, before.target);
  assert.deepEqual(statInput, before.stats);
  assert.deepEqual(purificationInput, before.purification);
  assert.deepEqual(trainingInput, before.training);
});

let failures = 0;
for (const {name, callback} of tests) {
  try {
    callback();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(error.stack || error);
  }
}

console.log(`${tests.length - failures}/${tests.length} mechanics tests passed`);
if (failures) process.exitCode = 1;
