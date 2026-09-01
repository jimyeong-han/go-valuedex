import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const mechanics = require('../mechanics.js');
const pveBoss = require('../pve-boss.js');

const {
  BOSS_TIER_PRESETS,
  analyzeBossBattle,
  calculateCycle,
  calculateMoveDamage,
  describeTypeEffectiveness,
  describeWeatherBoost,
  findAttackIvBreakpoints,
  getBossTierPreset,
  typeEffectiveness,
  weatherMultiplier
} = pveBoss;

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const powderSnow = deepFreeze({
  id: 'POWDER_SNOW', ko: '눈싸라기', type: 'ice', power: 6, energy: 15, duration: 1000
});
const avalanche = deepFreeze({
  id: 'AVALANCHE', ko: '눈사태', type: 'ice', power: 85, energy: -50, duration: 2500
});
const dragonTail = deepFreeze({
  id: 'DRAGON_TAIL', ko: '드래곤테일', type: 'dragon', power: 14, energy: 8, duration: 1000
});
const outrage = deepFreeze({
  id: 'OUTRAGE', ko: '역린', type: 'dragon', power: 110, energy: -50, duration: 4000
});

const mamoswine = deepFreeze({
  speciesKey: '473:normal',
  name: '맘모꾸리',
  stats: {attack: 247, defense: 146, stamina: 242},
  types: [{id: 'ice', ko: '얼음'}, {id: 'ground', ko: '땅'}],
  moves: {fast: [powderSnow], charged: [avalanche]}
});

const rayquaza = deepFreeze({
  speciesKey: '384:normal',
  name: '레쿠쟈',
  stats: {attack: 284, defense: 170, stamina: 213},
  types: [{id: 'dragon', ko: '드래곤'}, {id: 'flying', ko: '비행'}],
  moves: {fast: [dragonTail], charged: [outrage]}
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

function standardAnalysis(overrides = {}) {
  return analyzeBossBattle({
    pokemon: mamoswine,
    ivs: {attack: 15, defense: 15, stamina: 15},
    level: 40,
    status: 'normal',
    fastMove: 'POWDER_SNOW',
    chargedMove: 'AVALANCHE',
    boss: rayquaza,
    tier: 'five',
    weather: 'snow',
    partySize: 4,
    ...overrides
  });
}

test('CommonJS API exposes the stable cycle-proxy contract and frozen presets', () => {
  assert.equal(pveBoss.MODEL_VERSION, 'cycle-proxy-v2');
  assert.equal(typeof analyzeBossBattle, 'function');
  assert.equal(pveBoss.analyzePveBoss, analyzeBossBattle);
  assert.equal(typeof findAttackIvBreakpoints, 'function');
  assert.equal(Object.isFrozen(BOSS_TIER_PRESETS), true);
  assert.equal(Object.isFrozen(BOSS_TIER_PRESETS.five), true);
});

test('type effectiveness multiplies both defending types', () => {
  closeTo(typeEffectiveness('ice', ['dragon', 'flying']), 2.56);
  closeTo(typeEffectiveness('fire', ['grass', 'steel']), 2.56);
  closeTo(typeEffectiveness('grass', ['water', 'flying']), 1);

  const details = describeTypeEffectiveness('ice', [{id: 'dragon'}, {id: 'flying'}]);
  assert.equal(details.valid, true);
  assert.deepEqual(details.perType, [
    {type: 'dragon', multiplier: 1.6},
    {type: 'flying', multiplier: 1.6}
  ]);
});

test('GO immunity equivalents use 0.390625 and also compose with a second type', () => {
  closeTo(typeEffectiveness('normal', ['ghost']), 0.390625);
  closeTo(typeEffectiveness('ground', ['flying', 'steel']), 0.625);
  const invalid = describeTypeEffectiveness('stellar', ['dragon']);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.reasonCodes.includes('ATTACK_TYPE_INVALID'));
});

test('weather applies exactly 1.2 for canonical, aliased, and custom boosted types', () => {
  assert.equal(weatherMultiplier('ice', 'snow'), 1.2);
  assert.equal(weatherMultiplier('fire', 'sunny'), 1.2);
  assert.equal(weatherMultiplier('dragon', 'snow'), 1);
  assert.equal(weatherMultiplier('dragon', ['dragon', 'fairy']), 1.2);

  const rain = describeWeatherBoost('water', {id: 'event', boostedTypes: ['water']});
  assert.equal(rain.id, 'event');
  assert.equal(rain.custom, true);
  assert.equal(rain.boosted, true);
});

test('ally Mega boost supports named and custom multipliers without implicit self aura', () => {
  const baseOptions = {
    move: {type: 'normal', power: 100},
    attackerAttack: 100,
    defenderDefense: 100,
    attackerTypes: [],
    defenderTypes: ['normal']
  };
  const none = calculateMoveDamage(baseOptions);
  const matching = calculateMoveDamage({...baseOptions, allyMegaBoost: 'matching'});
  const other = calculateMoveDamage({...baseOptions, allyMegaBoost: 'other'});
  const custom = calculateMoveDamage({...baseOptions, allyMegaBoost: 1.25});

  assert.equal(none.damage, 51);
  assert.equal(none.allyMegaMultiplier, 1);
  assert.equal(matching.damage, 66);
  assert.deepEqual(matching.allyMegaBoost, {
    mode: 'matching', multiplier: 1.3, custom: false, reasonCodes: []
  });
  assert.equal(other.damage, 56);
  assert.equal(custom.damage, 63);
  assert.equal(custom.allyMegaBoost.custom, true);
});

test('typed ally Mega boost applies 1.3 only to matching move types and 1.1 otherwise', () => {
  const baseOptions = {
    attackerAttack: 100,
    defenderDefense: 100,
    attackerTypes: [],
    defenderTypes: ['normal'],
    allyMegaBoost: {boostedTypes: ['ice']}
  };
  const matching = calculateMoveDamage({
    ...baseOptions,
    move: {type: 'ice', power: 100}
  });
  const other = calculateMoveDamage({
    ...baseOptions,
    move: {type: 'ground', power: 100}
  });

  assert.equal(matching.allyMegaMultiplier, 1.3);
  assert.equal(matching.allyMegaBoost.matching, true);
  assert.deepEqual(matching.allyMegaBoost.boostedTypes, ['ice']);
  assert.equal(other.allyMegaMultiplier, 1.1);
  assert.equal(other.allyMegaBoost.matching, false);
});

test('boss tier aliases resolve to fresh estimate-marked values and accept overrides', () => {
  assert.equal(getBossTierPreset('1성').cpm, 0.5974);
  const five = getBossTierPreset('5성');
  assert.equal(five.id, 'five');
  assert.equal(five.hp, 15000);
  assert.equal(five.timeLimitSeconds, 300);
  assert.equal(five.estimate, true);
  assert.deepEqual(five.reasonCodes, []);

  const custom = getBossTierPreset('mega', {hp: 12345, cpm: 0.8});
  assert.equal(custom.hp, 12345);
  assert.equal(custom.cpm, 0.8);
  assert.equal(custom.overridden, true);
  assert.equal(BOSS_TIER_PRESETS.mega.hp, 9000);

  const fallback = getBossTierPreset('not-a-tier');
  assert.equal(fallback.id, 'five');
  assert.ok(fallback.reasonCodes.includes('BOSS_TIER_INVALID'));
});

test('integer move damage composes STAB, dual weakness, and weather multipliers', () => {
  const result = calculateMoveDamage({
    move: {type: 'ice', power: 10},
    attackerAttack: 100,
    defenderDefense: 100,
    attackerTypes: ['ice'],
    defenderTypes: ['dragon', 'flying'],
    weather: 'snow'
  });

  closeTo(result.typeMultiplier, 2.56);
  assert.equal(result.stabMultiplier, 1.2);
  assert.equal(result.weatherMultiplier, 1.2);
  closeTo(result.rawDamage, 18.432);
  assert.equal(result.damage, 19);
  assert.equal(result.estimate, true);
});

test('cycle proxy derives fast uses, total damage, duration, and DPS from actual moves', () => {
  const result = calculateCycle({
    fastMove: {id: 'FAST', type: 'normal', power: 10, energy: 10, duration: 1000},
    chargedMove: {id: 'CHARGED', type: 'normal', power: 100, energy: -50, duration: 2000},
    attackerAttack: 100,
    defenderDefense: 100,
    attackerTypes: [],
    defenderTypes: ['normal'],
    weather: 'none'
  });

  assert.equal(result.valid, true);
  assert.equal(result.fastUses, 5);
  assert.equal(result.energyGenerated, 50);
  assert.equal(result.damage, 81);
  assert.equal(result.seconds, 7);
  closeTo(result.dpsProxy, 81 / 7);
});

test('cycle proxy carries excess energy across a long-run average instead of discarding it', () => {
  const result = calculateCycle({
    fastMove: {id: 'FAST', type: 'normal', power: 10, energy: 15, duration: 1000},
    chargedMove: {id: 'CHARGED', type: 'normal', power: 100, energy: -50, duration: 2000},
    attackerAttack: 100,
    defenderDefense: 100,
    attackerTypes: [],
    defenderTypes: ['normal'],
    weather: 'none'
  });

  assert.equal(result.fastUses, 4);
  closeTo(result.averageFastUses, 50 / 15);
  assert.equal(result.damage, 75);
  assert.equal(result.seconds, 6);
  closeTo(result.averageDamage, 71);
  closeTo(result.averageSeconds, 16 / 3);
  closeTo(result.dpsProxy, 71 / (16 / 3));
  assert.equal(result.energyCarryModel, 'capped-long-run-average');
  assert.deepEqual(result.energyCyclePattern, [4, 3, 3]);
  assert.equal(result.averageEnergyWasted, 0);
});

test('100-energy cap discards overflow instead of carrying impossible excess energy', () => {
  const result = calculateCycle({
    fastMove: {id: 'FAST', type: 'normal', power: 10, energy: 15, duration: 1000},
    chargedMove: {id: 'CHARGED', type: 'normal', power: 100, energy: -100, duration: 2000},
    attackerAttack: 100,
    defenderDefense: 100,
    attackerTypes: [],
    defenderTypes: ['normal'],
    weather: 'none'
  });

  assert.equal(result.valid, true);
  assert.equal(result.fastUses, 7);
  assert.equal(result.averageFastUses, 7);
  assert.deepEqual(result.energyCyclePattern, [7]);
  assert.equal(result.averageEnergyWasted, 5);
  assert.equal(result.damage, 93);
  assert.equal(result.seconds, 9);
  closeTo(result.dpsProxy, 93 / 9);
});

test('zero charged energy is rejected instead of inventing an unsupported energy cost', () => {
  const result = calculateCycle({
    fastMove: {type: 'normal', power: 5, energy: 10, duration: 1000},
    chargedMove: {type: 'normal', power: 35, energy: 0, duration: 2000},
    attackerAttack: 100,
    defenderDefense: 100,
    defenderTypes: ['normal']
  });

  assert.equal(result.valid, false);
  assert.equal(result.fastUses, 0);
  assert.equal(result.chargedEnergyCost, 0);
  assert.equal(result.dpsProxy, 0);
  assert.ok(result.reasonCodes.includes('CHARGED_ENERGY_INVALID'));
});

test('zero-power fast moves remain valid and deal the integer minimum damage', () => {
  const result = calculateCycle({
    fastMove: {id: 'YAWN', type: 'normal', power: 0, energy: 13, duration: 1500},
    chargedMove: {id: 'PLAY_ROUGH', type: 'fairy', power: 90, energy: -50, duration: 3000},
    attackerAttack: 100,
    defenderDefense: 100,
    attackerTypes: ['normal'],
    defenderTypes: ['dragon']
  });

  assert.equal(result.valid, true);
  assert.equal(result.fast.damage, 1);
  assert.equal(result.fastUses, 4);
  assert.ok(result.dpsProxy > 0);
});

test('Mamoswine vs five-star Rayquaza fixture returns reproducible DPS and party estimates', () => {
  const result = standardAnalysis();

  assert.equal(result.valid, true);
  assert.equal(result.estimate, true);
  assert.equal(result.modelVersion, 'cycle-proxy-v2');
  assert.equal(result.boss.tier.id, 'five');
  assert.equal(result.boss.tier.estimate, true);
  assert.equal(result.outgoing.fastUses, 4);
  assert.equal(result.outgoing.fast.damage, 16);
  assert.equal(result.outgoing.charged.damage, 222);
  assert.equal(result.outgoing.damage, 286);
  assert.equal(result.outgoing.seconds, 6.5);
  closeTo(result.metrics.dpsProxy, 47.2);
  closeTo(result.metrics.estimatedPartyTimeSeconds, 79.4491525423729);
  assert.equal(result.metrics.estimatedRequiredPlayers, 2);
  assert.equal(result.metrics.clearsWithinTimer, true);
  assert.ok(result.assumptions.some(value => value.includes('dodging')));
  assert.ok(result.assumptions.some(value => value.includes('energy gained from incoming damage')));
});

test('party size scales estimated clear time without changing one-attacker DPS', () => {
  const solo = standardAnalysis({partySize: 1});
  const four = standardAnalysis({partySize: 4});
  assert.equal(solo.metrics.dpsProxy, four.metrics.dpsProxy);
  closeTo(solo.metrics.estimatedPartyTimeSeconds / four.metrics.estimatedPartyTimeSeconds, 4);
});

test('explicit ally Mega aura raises outgoing DPS and is disclosed in result assumptions', () => {
  const none = standardAnalysis({allyMegaBoost: 'none'});
  const matching = standardAnalysis({allyMegaBoost: 'matching'});

  assert.equal(none.allyMegaBoost.multiplier, 1);
  assert.equal(matching.allyMegaBoost.multiplier, 1.3);
  assert.ok(matching.metrics.dpsProxy > none.metrics.dpsProxy);
  assert.ok(matching.assumptions.some(value => value.includes('never receives its own Mega aura')));
  assert.equal(none.outgoing.fast.allyMegaMultiplier, 1);
  assert.equal(matching.outgoing.fast.allyMegaMultiplier, 1.3);
});

test('Shadow status applies attack and defense modifiers while preserving input CP/HP', () => {
  const normal = standardAnalysis({status: 'normal'});
  const shadow = standardAnalysis({status: 'shadow'});

  closeTo(shadow.attacker.stats.attack, normal.attacker.stats.attack * 1.2);
  closeTo(shadow.attacker.stats.defense, normal.attacker.stats.defense * (5 / 6));
  assert.equal(shadow.attacker.stats.hp, normal.attacker.stats.hp);
  assert.equal(shadow.attacker.stats.cp, normal.attacker.stats.cp);
  assert.ok(shadow.metrics.dpsProxy > normal.metrics.dpsProxy);
});

test('boss moves enable incoming-cycle survival and TDO estimates', () => {
  const withoutMoves = standardAnalysis();
  const withMoves = standardAnalysis({
    bossFastMove: 'DRAGON_TAIL',
    bossChargedMove: 'OUTRAGE'
  });

  assert.equal(withoutMoves.incoming, null);
  assert.equal(withoutMoves.metrics.tdoEstimate, null);
  assert.equal(withoutMoves.metrics.tdoModel, 'bulk-proxy');
  assert.ok(withoutMoves.metrics.tdoProxy > 0);
  assert.equal(withMoves.incoming.valid, true);
  assert.ok(withMoves.metrics.survivalSeconds > 0);
  assert.ok(withMoves.metrics.tdoEstimate > 0);
  assert.equal(withMoves.metrics.tdoModel, 'incoming-cycle-estimate');
});

test('attack-IV breakpoint search finds the discrete fast-move damage step', () => {
  const result = findAttackIvBreakpoints({
    pokemon: mamoswine,
    ivs: {attack: 0, defense: 15, stamina: 15},
    currentAttackIv: 0,
    level: 40,
    status: 'normal',
    fastMove: 'POWDER_SNOW',
    boss: rayquaza,
    tier: 'five',
    weather: 'snow'
  });

  assert.equal(result.valid, true);
  assert.equal(result.values.length, 16);
  assert.deepEqual(result.values.map(value => value.damage), [
    15, 15, 15, 15, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16
  ]);
  assert.equal(result.breakpoints.length, 1);
  assert.equal(result.breakpoints[0].attackIv, 4);
  assert.equal(result.breakpoints[0].previousDamage, 15);
  assert.equal(result.nextBreakpoint.attackIv, 4);
});

test('attack-IV breakpoints use the explicitly selected ally Mega multiplier', () => {
  const base = findAttackIvBreakpoints({
    pokemon: mamoswine,
    ivs: {attack: 0, defense: 15, stamina: 15},
    level: 40,
    fastMove: powderSnow,
    boss: rayquaza,
    tier: 'five',
    weather: 'snow',
    allyMegaBoost: 'none'
  });
  const boosted = findAttackIvBreakpoints({
    pokemon: mamoswine,
    ivs: {attack: 0, defense: 15, stamina: 15},
    level: 40,
    fastMove: powderSnow,
    boss: rayquaza,
    tier: 'five',
    weather: 'snow',
    allyMegaBoost: 'matching'
  });

  assert.equal(boosted.allyMegaBoost.mode, 'matching');
  assert.ok(boosted.values[0].damage > base.values[0].damage);
});

test('battle analysis leaves deeply frozen Pokemon, move, IV, and option inputs untouched', () => {
  const input = deepFreeze({
    pokemon: mamoswine,
    ivs: {attack: 13, defense: 14, stamina: 15},
    level: 40,
    status: 'shadow',
    fastMove: powderSnow,
    chargedMove: avalanche,
    boss: rayquaza,
    tier: {id: 'five', hp: 16000},
    weather: {id: 'event', boostedTypes: ['ice']},
    partySize: 3
  });
  const before = JSON.stringify(input);
  const result = analyzeBossBattle(input);

  assert.equal(result.valid, true);
  assert.equal(JSON.stringify(input), before);
  assert.equal(input.tier.hp, 16000);
  assert.equal(input.weather.boostedTypes[0], 'ice');
});

test('invalid battle data fails safely with reason codes and no NaN party time', () => {
  const result = analyzeBossBattle({
    pokemon: {stats: {attack: 100, defense: 100, stamina: 100}, types: ['normal'], moves: {}},
    ivs: {attack: 15, defense: 15, stamina: 15},
    level: 40,
    boss: {stats: {attack: 100, defense: 100, stamina: 100}, types: ['normal']},
    tier: 'unknown',
    partySize: 99
  });

  assert.equal(result.valid, false);
  assert.ok(result.reasonCodes.includes('BOSS_TIER_INVALID'));
  assert.ok(result.reasonCodes.includes('FAST_MOVE_REQUIRED'));
  assert.ok(result.reasonCodes.includes('CHARGED_MOVE_REQUIRED'));
  assert.ok(result.reasonCodes.includes('PARTY_SIZE_NORMALIZED'));
  assert.equal(result.metrics.partySize, 20);
  assert.equal(result.metrics.estimatedPartyTimeSeconds, null);
});

test('browser UMD contract installs ValueDexPveBoss without CommonJS globals', () => {
  const source = readFileSync(new URL('../pve-boss.js', import.meta.url), 'utf8');
  const window = {ValueDexMechanics: mechanics};
  vm.runInNewContext(source, {window, globalThis: window});

  assert.equal(typeof window.ValueDexPveBoss.analyzeBossBattle, 'function');
  assert.equal(window.ValueDexPveBoss.MODEL_VERSION, 'cycle-proxy-v2');
});

let failures = 0;
for (const {name, callback} of tests) {
  try {
    await callback();
    console.log(`\u2713 ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`\u2717 ${name}`);
    console.error(error && error.stack || error);
  }
}

if (failures) {
  console.error(`\n${failures}/${tests.length} PvE boss tests failed.`);
  process.exitCode = 1;
} else {
  console.log(`\n${tests.length}/${tests.length} PvE boss tests passed.`);
}
