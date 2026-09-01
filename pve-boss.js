(function installValueDexPveBoss(root, factory) {
  'use strict';

  const mechanics = typeof module === 'object' && module.exports
    ? require('./mechanics.js')
    : root && root.ValueDexMechanics;
  const api = factory(mechanics);

  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ValueDexPveBoss = api;
})(typeof window !== 'undefined' ? window : globalThis, function createValueDexPveBoss(mechanics) {
  'use strict';

  const MODEL_VERSION = 'cycle-proxy-v2';
  const SUPER_EFFECTIVE = 1.6;
  const NOT_VERY_EFFECTIVE = 0.625;
  const IMMUNITY_EQUIVALENT = 0.390625;
  const WEATHER_BOOST = 1.2;
  const STAB = 1.2;
  const ENERGY_CAP = 100;
  const ALLY_MEGA_BOOSTS = Object.freeze({
    none: 1,
    matching: 1.3,
    other: 1.1
  });
  const VALID_STATUSES = Object.freeze(['normal', 'shadow', 'purified']);
  const STATUS_MODIFIERS = Object.freeze({
    normal: Object.freeze({attack: 1, defense: 1}),
    shadow: Object.freeze({attack: 1.2, defense: 5 / 6}),
    purified: Object.freeze({attack: 1, defense: 1})
  });

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
  }

  // Pokemon GO replaces main-series immunities with a double resistance.
  const TYPE_RELATIONS = deepFreeze({
    normal: {strong: [], weak: ['rock', 'steel'], immune: ['ghost']},
    fighting: {
      strong: ['normal', 'ice', 'rock', 'dark', 'steel'],
      weak: ['poison', 'flying', 'psychic', 'bug', 'fairy'],
      immune: ['ghost']
    },
    flying: {strong: ['grass', 'fighting', 'bug'], weak: ['electric', 'rock', 'steel'], immune: []},
    poison: {strong: ['grass', 'fairy'], weak: ['poison', 'ground', 'rock', 'ghost'], immune: ['steel']},
    ground: {
      strong: ['fire', 'electric', 'poison', 'rock', 'steel'],
      weak: ['grass', 'bug'],
      immune: ['flying']
    },
    rock: {strong: ['fire', 'ice', 'flying', 'bug'], weak: ['fighting', 'ground', 'steel'], immune: []},
    bug: {
      strong: ['grass', 'psychic', 'dark'],
      weak: ['fire', 'fighting', 'poison', 'flying', 'ghost', 'steel', 'fairy'],
      immune: []
    },
    ghost: {strong: ['psychic', 'ghost'], weak: ['dark'], immune: ['normal']},
    steel: {strong: ['ice', 'rock', 'fairy'], weak: ['fire', 'water', 'electric', 'steel'], immune: []},
    fire: {strong: ['grass', 'ice', 'bug', 'steel'], weak: ['fire', 'water', 'rock', 'dragon'], immune: []},
    water: {strong: ['fire', 'ground', 'rock'], weak: ['water', 'grass', 'dragon'], immune: []},
    grass: {
      strong: ['water', 'ground', 'rock'],
      weak: ['fire', 'grass', 'poison', 'flying', 'bug', 'dragon', 'steel'],
      immune: []
    },
    electric: {strong: ['water', 'flying'], weak: ['electric', 'grass', 'dragon'], immune: ['ground']},
    psychic: {strong: ['fighting', 'poison'], weak: ['psychic', 'steel'], immune: ['dark']},
    ice: {strong: ['grass', 'ground', 'flying', 'dragon'], weak: ['fire', 'water', 'ice', 'steel'], immune: []},
    dragon: {strong: ['dragon'], weak: ['steel'], immune: ['fairy']},
    dark: {strong: ['psychic', 'ghost'], weak: ['fighting', 'dark', 'fairy'], immune: []},
    fairy: {strong: ['fighting', 'dragon', 'dark'], weak: ['fire', 'poison', 'steel'], immune: []}
  });

  const WEATHER_TYPES = deepFreeze({
    clear: ['grass', 'ground', 'fire'],
    rain: ['water', 'electric', 'bug'],
    partlyCloudy: ['normal', 'rock'],
    cloudy: ['fairy', 'fighting', 'poison'],
    windy: ['flying', 'dragon', 'psychic'],
    snow: ['ice', 'steel'],
    fog: ['ghost', 'dark']
  });

  const WEATHER_ALIASES = deepFreeze({
    sunny: 'clear',
    clear: 'clear',
    sun: 'clear',
    rain: 'rain',
    rainy: 'rain',
    partlycloudy: 'partlyCloudy',
    partly_cloudy: 'partlyCloudy',
    'partly-cloudy': 'partlyCloudy',
    cloudy: 'cloudy',
    overcast: 'cloudy',
    windy: 'windy',
    wind: 'windy',
    snow: 'snow',
    snowy: 'snow',
    fog: 'fog',
    foggy: 'fog',
    none: 'none'
  });

  /*
   * Raid parameters can change by event and are not an official live feed.
   * Every preset is therefore explicitly marked as an estimate and callers may
   * override hp, timeLimitSeconds, and cpm for the current raid.
   */
  const BOSS_TIER_PRESETS = deepFreeze({
    one: {
      id: 'one', label: '1성', stars: 1, hp: 600, timeLimitSeconds: 180, cpm: 0.5974,
      estimate: true, estimateFields: ['hp', 'timeLimitSeconds', 'cpm']
    },
    three: {
      id: 'three', label: '3성', stars: 3, hp: 3600, timeLimitSeconds: 180, cpm: 0.73,
      estimate: true, estimateFields: ['hp', 'timeLimitSeconds', 'cpm']
    },
    five: {
      id: 'five', label: '5성', stars: 5, hp: 15000, timeLimitSeconds: 300, cpm: 0.79,
      estimate: true, estimateFields: ['hp', 'timeLimitSeconds', 'cpm']
    },
    mega: {
      id: 'mega', label: '메가', stars: null, hp: 9000, timeLimitSeconds: 300, cpm: 0.79,
      estimate: true, estimateFields: ['hp', 'timeLimitSeconds', 'cpm']
    },
    megaLegendary: {
      id: 'megaLegendary', label: '전설 메가', stars: null, hp: 22500, timeLimitSeconds: 300, cpm: 0.79,
      estimate: true, estimateFields: ['hp', 'timeLimitSeconds', 'cpm']
    },
    primal: {
      id: 'primal', label: '원시', stars: null, hp: 22500, timeLimitSeconds: 300, cpm: 0.79,
      estimate: true, estimateFields: ['hp', 'timeLimitSeconds', 'cpm']
    },
    elite: {
      id: 'elite', label: '엘리트', stars: null, hp: 20000, timeLimitSeconds: 300, cpm: 0.79,
      estimate: true, estimateFields: ['hp', 'timeLimitSeconds', 'cpm']
    },
    dynamax: {
      id: 'dynamax', label: '다이맥스 일반 기술 근사', stars: null, hp: 15000, timeLimitSeconds: 300, cpm: 0.79,
      estimate: true, estimateFields: ['hp', 'timeLimitSeconds', 'cpm'], approximation: 'five-star-raid-cycle-default'
    }
  });

  const TIER_ALIASES = deepFreeze({
    one: 'one', '1': 'one', '1star': 'one', '1-star': 'one', tier1: 'one', '1성': 'one',
    three: 'three', '3': 'three', '3star': 'three', '3-star': 'three', tier3: 'three', '3성': 'three',
    five: 'five', '5': 'five', '5star': 'five', '5-star': 'five', tier5: 'five', '5성': 'five',
    mega: 'mega', '메가': 'mega',
    megalegendary: 'megaLegendary', 'mega-legendary': 'megaLegendary', '전설메가': 'megaLegendary',
    primal: 'primal', '원시': 'primal',
    elite: 'elite', '엘리트': 'elite',
    dynamax: 'dynamax', max: 'dynamax', '다이맥스': 'dynamax'
  });

  const ESTIMATE_ASSUMPTIONS = deepFreeze([
    'move cooldowns and carried energy are modeled as a long-run fast-to-charged cycle average with the 100-energy cap',
    'energy gained from incoming damage, finite-battle energy remainder, dodging, relobby time, friendship, party power, and network delay are omitted',
    'an ally Mega boost is applied only when explicitly selected; an attacker never receives its own Mega aura',
    'raid HP, timer, and boss CPM come from a configurable preset rather than a live official feed'
  ]);

  function unique(values) {
    return [...new Set(values)];
  }

  function finiteNumber(value, fallback = NaN) {
    if (value === '' || value === null || value === undefined) return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function positiveNumber(value, fallback = NaN) {
    const number = finiteNumber(value, fallback);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function clampInteger(value, minimum, maximum, fallback) {
    const number = finiteNumber(value, fallback);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.round(number)));
  }

  function normalizeType(type) {
    if (type && typeof type === 'object') return normalizeType(type.id || type.type || type.en);
    return String(type || '').trim().toLowerCase();
  }

  function normalizeTypes(types) {
    const source = Array.isArray(types) ? types : types ? [types] : [];
    return unique(source.map(normalizeType).filter(Boolean));
  }

  function relationMultiplier(attackType, defenseType) {
    const relation = TYPE_RELATIONS[attackType];
    if (!relation || !defenseType) return 1;
    if (relation.immune.includes(defenseType)) return IMMUNITY_EQUIVALENT;
    if (relation.strong.includes(defenseType)) return SUPER_EFFECTIVE;
    if (relation.weak.includes(defenseType)) return NOT_VERY_EFFECTIVE;
    return 1;
  }

  function describeTypeEffectiveness(attackTypeInput, defenderTypesInput) {
    const attackType = normalizeType(attackTypeInput);
    const defenderTypes = normalizeTypes(defenderTypesInput);
    const perType = defenderTypes.map(type => ({
      type,
      multiplier: relationMultiplier(attackType, type)
    }));
    const multiplier = perType.reduce((product, item) => product * item.multiplier, 1);
    const valid = Boolean(TYPE_RELATIONS[attackType]) && defenderTypes.length > 0;
    const reasonCodes = [];
    if (!TYPE_RELATIONS[attackType]) reasonCodes.push('ATTACK_TYPE_INVALID');
    if (!defenderTypes.length) reasonCodes.push('DEFENDER_TYPES_REQUIRED');
    if (defenderTypes.some(type => !TYPE_RELATIONS[type])) reasonCodes.push('DEFENDER_TYPE_INVALID');
    return {
      attackType,
      defenderTypes,
      perType,
      multiplier,
      valid: valid && !reasonCodes.length,
      reasonCodes
    };
  }

  function typeEffectiveness(attackType, defenderTypes) {
    return describeTypeEffectiveness(attackType, defenderTypes).multiplier;
  }

  function normalizeWeather(weatherInput) {
    if (Array.isArray(weatherInput)) {
      return {id: 'custom', boostedTypes: normalizeTypes(weatherInput), custom: true};
    }
    if (weatherInput && typeof weatherInput === 'object') {
      if (Array.isArray(weatherInput.boostedTypes)) {
        return {
          id: String(weatherInput.id || 'custom'),
          boostedTypes: normalizeTypes(weatherInput.boostedTypes),
          custom: true
        };
      }
      return normalizeWeather(weatherInput.id || weatherInput.name);
    }
    const compact = String(weatherInput || 'none').trim().replace(/\s+/g, '').toLowerCase();
    const id = WEATHER_ALIASES[compact] || 'none';
    return {id, boostedTypes: WEATHER_TYPES[id] ? [...WEATHER_TYPES[id]] : [], custom: false};
  }

  function describeWeatherBoost(moveTypeInput, weatherInput) {
    const moveType = normalizeType(moveTypeInput);
    const weather = normalizeWeather(weatherInput);
    const boosted = Boolean(moveType) && weather.boostedTypes.includes(moveType);
    return {
      ...weather,
      moveType,
      boosted,
      multiplier: boosted ? WEATHER_BOOST : 1
    };
  }

  function weatherMultiplier(moveType, weather) {
    return describeWeatherBoost(moveType, weather).multiplier;
  }

  function normalizeStatus(statusInput) {
    const requested = String(statusInput || 'normal').toLowerCase();
    const status = VALID_STATUSES.includes(requested) ? requested : 'normal';
    return {
      status,
      modifiers: {...STATUS_MODIFIERS[status]},
      reasonCodes: status === requested ? [] : ['STATUS_INVALID']
    };
  }

  function normalizeAllyMegaBoost(boostInput, moveTypeInput = '') {
    if (boostInput && typeof boostInput === 'object') {
      if (Array.isArray(boostInput.boostedTypes)) {
        const boostedTypes = normalizeTypes(boostInput.boostedTypes);
        if (!boostedTypes.length) {
          return {mode: 'none', multiplier: 1, custom: false, boostedTypes: [], matching: false, reasonCodes: ['ALLY_MEGA_BOOST_INVALID']};
        }
        const moveType = normalizeType(moveTypeInput);
        const matching = moveType ? boostedTypes.includes(moveType) : null;
        return {
          mode: 'typed',
          multiplier: matching === null ? null : matching ? 1.3 : 1.1,
          custom: false,
          boostedTypes,
          matching,
          reasonCodes: []
        };
      }
      const multiplier = positiveNumber(boostInput.multiplier);
      if (Number.isFinite(multiplier)) {
        return {
          mode: String(boostInput.mode || 'custom'),
          multiplier,
          custom: true,
          reasonCodes: []
        };
      }
      return {mode: 'none', multiplier: 1, custom: false, reasonCodes: ['ALLY_MEGA_BOOST_INVALID']};
    }
    if (typeof boostInput === 'number') {
      const multiplier = positiveNumber(boostInput);
      return Number.isFinite(multiplier)
        ? {mode: 'custom', multiplier, custom: true, reasonCodes: []}
        : {mode: 'none', multiplier: 1, custom: false, reasonCodes: ['ALLY_MEGA_BOOST_INVALID']};
    }
    const mode = String(boostInput || 'none').trim().toLowerCase();
    if (Object.hasOwn(ALLY_MEGA_BOOSTS, mode)) {
      return {mode, multiplier: ALLY_MEGA_BOOSTS[mode], custom: false, reasonCodes: []};
    }
    return {mode: 'none', multiplier: 1, custom: false, reasonCodes: ['ALLY_MEGA_BOOST_INVALID']};
  }

  function resolveTier(tierInput) {
    const raw = tierInput && typeof tierInput === 'object' ? tierInput.id : tierInput;
    const compact = String(raw || 'five').trim().replace(/\s+/g, '').toLowerCase();
    const id = TIER_ALIASES[compact] || (BOSS_TIER_PRESETS[raw] ? raw : 'five');
    return {
      id,
      valid: Boolean(TIER_ALIASES[compact] || BOSS_TIER_PRESETS[raw] || !raw),
      reasonCodes: TIER_ALIASES[compact] || BOSS_TIER_PRESETS[raw] || !raw
        ? []
        : ['BOSS_TIER_INVALID']
    };
  }

  function getBossTierPreset(tierInput = 'five', overrides = {}) {
    const resolved = resolveTier(tierInput);
    const sourceOverrides = tierInput && typeof tierInput === 'object'
      ? {...tierInput, ...overrides}
      : {...overrides};
    const base = BOSS_TIER_PRESETS[resolved.id];
    const hp = positiveNumber(sourceOverrides.hp, base.hp);
    const timeLimitSeconds = positiveNumber(sourceOverrides.timeLimitSeconds, base.timeLimitSeconds);
    const cpm = positiveNumber(sourceOverrides.cpm, base.cpm);
    return {
      ...base,
      hp,
      timeLimitSeconds,
      cpm,
      estimate: sourceOverrides.estimate !== false,
      estimateFields: [...base.estimateFields],
      overridden: hp !== base.hp || timeLimitSeconds !== base.timeLimitSeconds || cpm !== base.cpm,
      reasonCodes: [...resolved.reasonCodes]
    };
  }

  function moveDurationSeconds(move) {
    const explicit = positiveNumber(move && move.durationSeconds);
    if (Number.isFinite(explicit)) return explicit;
    const milliseconds = positiveNumber(move && (move.durationMs ?? move.duration));
    return Number.isFinite(milliseconds) ? milliseconds / 1000 : NaN;
  }

  function longRunEnergyCycle(fastEnergy, chargedEnergy) {
    if (!Number.isFinite(fastEnergy) || fastEnergy <= 0) return null;
    if (!Number.isFinite(chargedEnergy) || chargedEnergy <= 0 || chargedEnergy > ENERGY_CAP) return null;
    const cycles = [];
    const seen = new Map();
    let energy = 0;
    for (let step = 0; step < 4096; step += 1) {
      const key = energy.toFixed(9);
      if (seen.has(key)) {
        const repeating = cycles.slice(seen.get(key));
        if (!repeating.length) return null;
        return {
          initialFastUses: cycles[0].fastUses,
          averageFastUses: repeating.reduce((sum, cycle) => sum + cycle.fastUses, 0) / repeating.length,
          averageEnergyWasted: repeating.reduce((sum, cycle) => sum + cycle.energyWasted, 0) / repeating.length,
          pattern: repeating.map(cycle => cycle.fastUses),
          period: repeating.length
        };
      }
      seen.set(key, cycles.length);
      const needed = Math.max(0, chargedEnergy - energy);
      const fastUses = needed <= 1e-9 ? 0 : Math.ceil((needed - 1e-9) / fastEnergy);
      const uncappedEnergy = energy + fastUses * fastEnergy;
      const cappedEnergy = Math.min(ENERGY_CAP, uncappedEnergy);
      if (cappedEnergy + 1e-9 < chargedEnergy) return null;
      cycles.push({fastUses, energyWasted: Math.max(0, uncappedEnergy - ENERGY_CAP)});
      energy = Math.round(Math.max(0, cappedEnergy - chargedEnergy) * 1e9) / 1e9;
    }
    return null;
  }

  function resolveMove(moveInput, pokemon, kind) {
    if (moveInput && typeof moveInput === 'object') return {...moveInput};
    if (moveInput == null || String(moveInput).trim() === '') return null;
    const requested = String(moveInput || '').trim().toLowerCase();
    const moves = pokemon && pokemon.moves && Array.isArray(pokemon.moves[kind])
      ? pokemon.moves[kind]
      : [];
    const found = moves.find(move => [move.id, move.en, move.ko]
      .some(value => String(value || '').toLowerCase() === requested));
    return found ? {...found} : null;
  }

  /**
   * Pokemon GO's integer PvE damage formula. This helper deliberately does not
   * apply Shadow modifiers; pass the already adjusted combat attack instead.
   */
  function calculateMoveDamage(options = {}) {
    const move = options.move && typeof options.move === 'object' ? options.move : {};
    const power = Math.max(0, finiteNumber(move.power, NaN));
    const attackerAttack = positiveNumber(options.attackerAttack);
    const defenderDefense = positiveNumber(options.defenderDefense);
    const moveType = normalizeType(move.type);
    const attackerTypes = normalizeTypes(options.attackerTypes);
    const stabMultiplier = attackerTypes.includes(moveType) ? STAB : 1;
    const effectiveness = describeTypeEffectiveness(moveType, options.defenderTypes);
    const weather = describeWeatherBoost(moveType, options.weather);
    const allyMegaBoost = normalizeAllyMegaBoost(options.allyMegaBoost, moveType);
    const reasonCodes = [
      ...effectiveness.reasonCodes,
      ...allyMegaBoost.reasonCodes
    ];
    if (!Number.isFinite(power)) reasonCodes.push('MOVE_POWER_INVALID');
    if (!Number.isFinite(attackerAttack)) reasonCodes.push('ATTACK_STAT_INVALID');
    if (!Number.isFinite(defenderDefense)) reasonCodes.push('DEFENSE_STAT_INVALID');
    const valid = !reasonCodes.length;
    const rawDamage = valid
      ? 0.5 * power * attackerAttack / defenderDefense
        * stabMultiplier * effectiveness.multiplier * weather.multiplier * allyMegaBoost.multiplier
      : 0;
    return {
      damage: valid ? Math.floor(rawDamage) + 1 : 0,
      rawDamage,
      power: Number.isFinite(power) ? power : 0,
      moveType,
      stabMultiplier,
      typeMultiplier: effectiveness.multiplier,
      weatherMultiplier: weather.multiplier,
      allyMegaMultiplier: allyMegaBoost.multiplier,
      totalMultiplier: stabMultiplier * effectiveness.multiplier
        * weather.multiplier * allyMegaBoost.multiplier,
      effectiveness,
      weather,
      allyMegaBoost,
      valid,
      reasonCodes: unique(reasonCodes),
      estimate: true,
      modelVersion: MODEL_VERSION
    };
  }

  function calculateCycle(options = {}) {
    const fastMove = options.fastMove && typeof options.fastMove === 'object' ? options.fastMove : {};
    const chargedMove = options.chargedMove && typeof options.chargedMove === 'object'
      ? options.chargedMove
      : {};
    const fastDamage = calculateMoveDamage({...options, move: fastMove});
    const chargedDamage = calculateMoveDamage({...options, move: chargedMove});
    const fastEnergy = positiveNumber(fastMove.energy);
    const rawChargedEnergy = finiteNumber(chargedMove.energy);
    const chargedEnergy = Number.isFinite(rawChargedEnergy) && rawChargedEnergy !== 0
      ? Math.abs(rawChargedEnergy)
      : NaN;
    const fastSeconds = moveDurationSeconds(fastMove);
    const chargedSeconds = moveDurationSeconds(chargedMove);
    const reasonCodes = [...fastDamage.reasonCodes, ...chargedDamage.reasonCodes];
    if (!Number.isFinite(fastEnergy)) reasonCodes.push('FAST_ENERGY_INVALID');
    if (!Number.isFinite(rawChargedEnergy) || rawChargedEnergy === 0) {
      reasonCodes.push('CHARGED_ENERGY_INVALID');
    }
    if (!Number.isFinite(fastSeconds)) reasonCodes.push('FAST_DURATION_INVALID');
    if (!Number.isFinite(chargedSeconds)) reasonCodes.push('CHARGED_DURATION_INVALID');
    const energyCycle = longRunEnergyCycle(fastEnergy, chargedEnergy);
    if (chargedEnergy > ENERGY_CAP) reasonCodes.push('CHARGED_ENERGY_EXCEEDS_CAP');
    if (Number.isFinite(fastEnergy) && !energyCycle) reasonCodes.push('ENERGY_CYCLE_UNRESOLVED');
    const averageFastUses = energyCycle ? energyCycle.averageFastUses : 0;
    const fastUses = energyCycle ? energyCycle.initialFastUses : 0;
    const damage = fastUses * fastDamage.damage + chargedDamage.damage;
    const seconds = fastUses * (Number.isFinite(fastSeconds) ? fastSeconds : 0)
      + (Number.isFinite(chargedSeconds) ? chargedSeconds : 0);
    const averageDamage = averageFastUses * fastDamage.damage + chargedDamage.damage;
    const averageSeconds = averageFastUses * (Number.isFinite(fastSeconds) ? fastSeconds : 0)
      + (Number.isFinite(chargedSeconds) ? chargedSeconds : 0);
    const blockingCodes = new Set([
      'MOVE_POWER_INVALID', 'ATTACK_STAT_INVALID', 'DEFENSE_STAT_INVALID',
      'ATTACK_TYPE_INVALID', 'DEFENDER_TYPES_REQUIRED', 'DEFENDER_TYPE_INVALID',
      'FAST_ENERGY_INVALID', 'CHARGED_ENERGY_INVALID', 'CHARGED_ENERGY_EXCEEDS_CAP', 'ENERGY_CYCLE_UNRESOLVED',
      'FAST_DURATION_INVALID', 'CHARGED_DURATION_INVALID'
    ]);
    const valid = seconds > 0 && averageSeconds > 0 && !reasonCodes.some(code => blockingCodes.has(code));
    return {
      fastUses,
      averageFastUses,
      chargedUses: 1,
      energyGenerated: fastUses * (Number.isFinite(fastEnergy) ? fastEnergy : 0),
      chargedEnergyCost: Number.isFinite(chargedEnergy) ? chargedEnergy : 0,
      damage,
      seconds,
      averageDamage,
      averageSeconds,
      dpsProxy: valid ? averageDamage / averageSeconds : 0,
      energyCarryModel: 'capped-long-run-average',
      energyCap: ENERGY_CAP,
      energyCyclePattern: energyCycle ? [...energyCycle.pattern] : [],
      energyCyclePeriod: energyCycle ? energyCycle.period : 0,
      averageEnergyWasted: energyCycle ? energyCycle.averageEnergyWasted : 0,
      fast: {...fastDamage, move: {...fastMove}, durationSeconds: fastSeconds},
      charged: {...chargedDamage, move: {...chargedMove}, durationSeconds: chargedSeconds},
      valid,
      reasonCodes: unique(reasonCodes),
      estimate: true,
      modelVersion: MODEL_VERSION
    };
  }

  function combatStatsFor(pokemon, ivs, level, status, cpmSource) {
    if (!mechanics || typeof mechanics.statsAt !== 'function') {
      return {valid: false, reasonCodes: ['MECHANICS_UNAVAILABLE']};
    }
    const base = mechanics.statsAt(pokemon || {}, ivs || {}, level, cpmSource);
    if (typeof mechanics.applyStatusModifiers === 'function') {
      return mechanics.applyStatusModifiers(base, status);
    }
    const normalized = normalizeStatus(status);
    return {
      ...base,
      attack: base.attack * normalized.modifiers.attack,
      defense: base.defense * normalized.modifiers.defense,
      status: normalized.status,
      modifiers: normalized.modifiers,
      valid: base.valid !== false && !normalized.reasonCodes.length,
      reasonCodes: unique([...(base.reasonCodes || []), ...normalized.reasonCodes])
    };
  }

  function resolveBossCombatStats(boss, preset, options) {
    const stats = boss && boss.stats && typeof boss.stats === 'object' ? boss.stats : (boss || {});
    const raidIvs = options.bossIvs && typeof options.bossIvs === 'object'
      ? options.bossIvs
      : {attack: 15, defense: 15, stamina: 15};
    const attack = positiveNumber(
      options.bossAttack ?? (boss && boss.combatAttack),
      (positiveNumber(stats.attack, 0) + finiteNumber(raidIvs.attack, 15)) * preset.cpm
    );
    const defense = positiveNumber(
      options.bossDefense ?? (boss && boss.combatDefense),
      (positiveNumber(stats.defense, 0) + finiteNumber(raidIvs.defense, 15)) * preset.cpm
    );
    const hp = positiveNumber(options.bossHp ?? (boss && boss.raidHp), preset.hp);
    return {attack, defense, hp, cpm: preset.cpm, ivs: {...raidIvs}};
  }

  /**
   * Estimate one attacker's boss performance. The result is intentionally a
   * proxy, not a battle simulator; `estimate` and `assumptions` are always
   * present so the UI cannot accidentally present party time as an exact fact.
   */
  function analyzeBossBattle(options = {}) {
    const pokemon = options.pokemon || (options.attacker && options.attacker.pokemon) || options.attacker;
    const attackerOptions = options.attacker && options.attacker.pokemon ? options.attacker : options;
    const boss = options.boss && options.boss.pokemon ? options.boss.pokemon : options.boss;
    const bossOptions = options.boss && options.boss.pokemon ? options.boss : {};
    const tier = getBossTierPreset(
      options.tier ?? bossOptions.tier ?? 'five',
      options.tierOverrides || bossOptions.tierOverrides
    );
    const status = normalizeStatus(attackerOptions.status || 'normal');
    const attackerStats = combatStatsFor(
      pokemon,
      attackerOptions.ivs || options.ivs,
      attackerOptions.level ?? options.level ?? 40,
      status.status,
      attackerOptions.cpmSource || options.cpmSource
    );
    const bossStats = resolveBossCombatStats(boss, tier, {
      ...bossOptions,
      bossIvs: options.bossIvs ?? bossOptions.ivs,
      bossAttack: options.bossAttack ?? bossOptions.attack,
      bossDefense: options.bossDefense ?? bossOptions.defense,
      bossHp: options.bossHp ?? bossOptions.hp
    });
    const fastMove = resolveMove(attackerOptions.fastMove ?? options.fastMove, pokemon, 'fast');
    const chargedMove = resolveMove(attackerOptions.chargedMove ?? options.chargedMove, pokemon, 'charged');
    const reasonCodes = [...tier.reasonCodes, ...status.reasonCodes, ...(attackerStats.reasonCodes || [])];
    if (!pokemon || !pokemon.stats) reasonCodes.push('ATTACKER_REQUIRED');
    if (!boss || !boss.stats) reasonCodes.push('BOSS_REQUIRED');
    if (!fastMove) reasonCodes.push('FAST_MOVE_REQUIRED');
    if (!chargedMove) reasonCodes.push('CHARGED_MOVE_REQUIRED');

    const outgoing = fastMove && chargedMove
      ? calculateCycle({
        fastMove,
        chargedMove,
        attackerAttack: attackerStats.attack,
        defenderDefense: bossStats.defense,
        attackerTypes: pokemon && pokemon.types,
        defenderTypes: boss && boss.types,
        weather: options.weather,
        allyMegaBoost: options.allyMegaBoost
      })
      : {
        fastUses: 0, chargedUses: 0, damage: 0, seconds: 0, dpsProxy: 0,
        valid: false, reasonCodes: ['MOVESET_REQUIRED'], estimate: true,
        modelVersion: MODEL_VERSION
      };
    reasonCodes.push(...outgoing.reasonCodes);

    const bossFastMove = resolveMove(
      options.bossFastMove ?? bossOptions.fastMove,
      boss,
      'fast'
    );
    const bossChargedMove = resolveMove(
      options.bossChargedMove ?? bossOptions.chargedMove,
      boss,
      'charged'
    );
    const incoming = bossFastMove && bossChargedMove
      ? calculateCycle({
        fastMove: bossFastMove,
        chargedMove: bossChargedMove,
        attackerAttack: bossStats.attack,
        defenderDefense: attackerStats.defense,
        attackerTypes: boss && boss.types,
        defenderTypes: pokemon && pokemon.types,
        weather: options.weather
      })
      : null;

    const partySize = clampInteger(options.partySize, 1, 20, 1);
    if (finiteNumber(options.partySize, 1) !== partySize) reasonCodes.push('PARTY_SIZE_NORMALIZED');
    const dpsProxy = outgoing.dpsProxy;
    const bulkProxy = positiveNumber(attackerStats.defense, 0) * positiveNumber(attackerStats.hp, 0) / 1000;
    const tdoProxy = dpsProxy * bulkProxy;
    const survivalSeconds = incoming && incoming.valid && incoming.dpsProxy > 0
      ? attackerStats.hp / incoming.dpsProxy
      : null;
    const tdoEstimate = survivalSeconds === null ? null : dpsProxy * survivalSeconds;
    const estimatedPartyTimeSeconds = dpsProxy > 0
      ? bossStats.hp / (dpsProxy * partySize)
      : null;
    const estimatedRequiredPlayers = dpsProxy > 0
      ? Math.max(1, Math.ceil(bossStats.hp / (dpsProxy * tier.timeLimitSeconds)))
      : null;
    const valid = Boolean(
      pokemon && pokemon.stats && boss && boss.stats && attackerStats.valid !== false && outgoing.valid
    );

    return {
      valid,
      reasonCodes: unique(reasonCodes),
      estimate: true,
      modelVersion: MODEL_VERSION,
      assumptions: [...ESTIMATE_ASSUMPTIONS],
      attacker: {
        speciesKey: pokemon && pokemon.speciesKey || null,
        status: status.status,
        stats: {...attackerStats},
        types: normalizeTypes(pokemon && pokemon.types)
      },
      boss: {
        speciesKey: boss && boss.speciesKey || null,
        tier: {...tier, estimateFields: [...tier.estimateFields], reasonCodes: [...tier.reasonCodes]},
        stats: {...bossStats, ivs: {...bossStats.ivs}},
        types: normalizeTypes(boss && boss.types)
      },
      weather: normalizeWeather(options.weather),
      allyMegaBoost: normalizeAllyMegaBoost(options.allyMegaBoost),
      outgoing,
      incoming,
      metrics: {
        dpsProxy,
        bulkProxy,
        tdoProxy,
        tdoEstimate,
        tdoModel: tdoEstimate === null ? 'bulk-proxy' : 'incoming-cycle-estimate',
        partySize,
        estimatedPartyTimeSeconds,
        estimatedRequiredPlayers,
        timeLimitSeconds: tier.timeLimitSeconds,
        clearsWithinTimer: estimatedPartyTimeSeconds === null
          ? false
          : estimatedPartyTimeSeconds <= tier.timeLimitSeconds,
        timerMarginSeconds: estimatedPartyTimeSeconds === null
          ? null
          : tier.timeLimitSeconds - estimatedPartyTimeSeconds,
        survivalSeconds
      }
    };
  }

  function findAttackIvBreakpoints(options = {}) {
    const pokemon = options.pokemon || (options.attacker && options.attacker.pokemon) || options.attacker;
    const attackerOptions = options.attacker && options.attacker.pokemon ? options.attacker : options;
    const boss = options.boss && options.boss.pokemon ? options.boss.pokemon : options.boss;
    const bossOptions = options.boss && options.boss.pokemon ? options.boss : {};
    const tier = getBossTierPreset(
      options.tier ?? bossOptions.tier ?? 'five',
      options.tierOverrides || bossOptions.tierOverrides
    );
    const status = normalizeStatus(attackerOptions.status || 'normal');
    const fastMove = resolveMove(attackerOptions.fastMove ?? options.fastMove, pokemon, 'fast');
    const baseIvs = attackerOptions.ivs || options.ivs || {};
    const currentAttackIv = clampInteger(
      options.currentAttackIv ?? baseIvs.attack,
      0,
      15,
      0
    );
    const bossStats = resolveBossCombatStats(boss, tier, {
      ...bossOptions,
      bossIvs: options.bossIvs ?? bossOptions.ivs,
      bossDefense: options.bossDefense ?? bossOptions.defense,
      bossAttack: options.bossAttack ?? bossOptions.attack,
      bossHp: options.bossHp ?? bossOptions.hp
    });
    const values = [];
    const reasonCodes = [...tier.reasonCodes, ...status.reasonCodes];
    if (!pokemon || !pokemon.stats) reasonCodes.push('ATTACKER_REQUIRED');
    if (!boss || !boss.stats) reasonCodes.push('BOSS_REQUIRED');
    if (!fastMove) reasonCodes.push('FAST_MOVE_REQUIRED');

    if (pokemon && pokemon.stats && boss && boss.stats && fastMove) {
      for (let attackIv = 0; attackIv <= 15; attackIv += 1) {
        const stats = combatStatsFor(
          pokemon,
          {...baseIvs, attack: attackIv},
          attackerOptions.level ?? options.level ?? 40,
          status.status,
          attackerOptions.cpmSource || options.cpmSource
        );
        const damage = calculateMoveDamage({
          move: fastMove,
          attackerAttack: stats.attack,
          defenderDefense: bossStats.defense,
          attackerTypes: pokemon.types,
          defenderTypes: boss.types,
          weather: options.weather,
          allyMegaBoost: options.allyMegaBoost
        });
        values.push({
          attackIv,
          attack: stats.attack,
          damage: damage.damage,
          valid: stats.valid !== false && damage.valid,
          reasonCodes: unique([...(stats.reasonCodes || []), ...damage.reasonCodes])
        });
      }
    }

    const breakpoints = values
      .filter((value, index) => index > 0 && value.damage > values[index - 1].damage)
      .map((value, index, all) => ({
        ...value,
        previousDamage: values[value.attackIv - 1].damage,
        damageGain: value.damage - values[value.attackIv - 1].damage,
        ordinal: index + 1,
        total: all.length
      }));
    const current = values[currentAttackIv] || null;
    const nextBreakpoint = current
      ? breakpoints.find(value => value.attackIv > currentAttackIv && value.damage > current.damage) || null
      : null;
    const valid = values.length === 16 && values.every(value => value.valid);
    for (const value of values) reasonCodes.push(...value.reasonCodes);

    return {
      valid,
      reasonCodes: unique(reasonCodes),
      estimate: true,
      modelVersion: MODEL_VERSION,
      currentAttackIv,
      currentDamage: current ? current.damage : 0,
      values,
      breakpoints,
      nextBreakpoint,
      maxDamage: values.length ? values[values.length - 1].damage : 0,
      bossDefense: bossStats.defense,
      tier: {...tier, estimateFields: [...tier.estimateFields], reasonCodes: [...tier.reasonCodes]},
      weather: normalizeWeather(options.weather),
      allyMegaBoost: normalizeAllyMegaBoost(options.allyMegaBoost),
      status: status.status
    };
  }

  return Object.freeze({
    MODEL_VERSION,
    BOSS_TIER_PRESETS,
    ESTIMATE_ASSUMPTIONS,
    STATUS_MODIFIERS,
    ALLY_MEGA_BOOSTS,
    TYPE_RELATIONS,
    WEATHER_TYPES,
    constants: Object.freeze({
      SUPER_EFFECTIVE,
      NOT_VERY_EFFECTIVE,
      IMMUNITY_EQUIVALENT,
      WEATHER_BOOST,
      STAB,
      ENERGY_CAP
    }),
    typeEffectiveness,
    describeTypeEffectiveness,
    weatherMultiplier,
    describeWeatherBoost,
    getBossTierPreset,
    calculateMoveDamage,
    calculateCycle,
    analyzeBossBattle,
    analyzePveBoss: analyzeBossBattle,
    findAttackIvBreakpoints
  });
});
