(function installValueDexMechanics(factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ValueDexMechanics = api;
})(function createValueDexMechanics() {
  'use strict';

  /**
   * Pokemon GO CP multipliers for levels 1 through 50 in half-level steps.
   * Callers may pass this array, another array with the same layout, a
   * `(level) => cpm` function, or `{cpmAt, minLevel, maxLevel, step}` to
   * statsAt/bestUnderCap.
   */
  const DEFAULT_CPM = Object.freeze([
    0.094, 0.135137432, 0.16639787, 0.192650919, 0.21573247,
    0.236572661, 0.25572005, 0.273530381, 0.29024988, 0.306057377,
    0.3210876, 0.335445036, 0.34921268, 0.362457751, 0.3752356,
    0.387592406, 0.39956728, 0.411193551, 0.4225, 0.432926419,
    0.44310755, 0.453059958, 0.4627984, 0.472336083, 0.48168495,
    0.4908558, 0.49985844, 0.508701765, 0.51739395, 0.525942511,
    0.5343543, 0.542635767, 0.5507927, 0.558830576, 0.5667545,
    0.574569153, 0.5822789, 0.589887917, 0.5974, 0.604818814,
    0.6121573, 0.619404122, 0.6265671, 0.633649143, 0.64065295,
    0.647580967, 0.65443563, 0.661219252, 0.667934, 0.674581896,
    0.6811649, 0.687684904, 0.69414365, 0.70054287, 0.7068842,
    0.713169109, 0.7193991, 0.725575614, 0.7317, 0.734741009,
    0.7377695, 0.740785574, 0.74378943, 0.746781211, 0.74976104,
    0.752729087, 0.7556855, 0.758630378, 0.76156384, 0.764486065,
    0.76739717, 0.770297266, 0.7731865, 0.776064962, 0.77893275,
    0.781790055, 0.784637, 0.787473578, 0.7903, 0.792803968,
    0.79530001, 0.797803921, 0.8003, 0.802799995, 0.8053,
    0.8078, 0.81029999, 0.812799985, 0.81529999, 0.81779999,
    0.82029999, 0.82279999, 0.82529999, 0.82779999, 0.83029999,
    0.83279999, 0.83529999, 0.83779999, 0.84029999
  ]);

  const IV_KEYS = Object.freeze(['attack', 'defense', 'stamina']);
  const VALID_STATUSES = Object.freeze(['normal', 'shadow', 'purified']);
  const STATUS_MODIFIERS = Object.freeze({
    normal: Object.freeze({attack: 1, defense: 1}),
    shadow: Object.freeze({attack: 1.2, defense: 5 / 6}),
    purified: Object.freeze({attack: 1, defense: 1})
  });

  const REASON_CODES = Object.freeze({
    ALREADY_PERFECT: 'ALREADY_PERFECT',
    CAP_TYPE_REQUIRED: 'CAP_TYPE_REQUIRED',
    GOOD_BUDDY_REQUIRED: 'GOOD_BUDDY_REQUIRED',
    NO_INCREASE: 'NO_INCREASE',
    NOT_SHADOW: 'NOT_SHADOW',
    POKEMON_REQUIRED: 'POKEMON_REQUIRED',
    PURIFICATION_COST_MISSING: 'PURIFICATION_COST_MISSING',
    SHADOW_INELIGIBLE: 'SHADOW_INELIGIBLE',
    SILVER_SINGLE_STAT_ONLY: 'SILVER_SINGLE_STAT_ONLY',
    SILVER_STAT_NO_INCREASE: 'SILVER_STAT_NO_INCREASE',
    SILVER_STAT_REQUIRED: 'SILVER_STAT_REQUIRED',
    STAT_CALCULATION_INVALID: 'STAT_CALCULATION_INVALID',
    STATUS_INVALID: 'STATUS_INVALID',
    TARGET_BELOW_CURRENT: 'TARGET_BELOW_CURRENT'
  });

  function unique(values) {
    return [...new Set(values)];
  }

  function toNumber(value) {
    if (value === '' || value === null || value === undefined) return NaN;
    return Number(value);
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function roundForStep(value, minimum, step) {
    const rounded = minimum + Math.round((value - minimum) / step) * step;
    return Number(rounded.toFixed(8));
  }

  function normalizeIvs(input, prefix = 'IV') {
    const source = input && typeof input === 'object' ? input : {};
    const ivs = {};
    const codes = [];

    for (const key of IV_KEYS) {
      const raw = toNumber(source[key]);
      const codeKey = key.toUpperCase();
      if (!Number.isFinite(raw)) {
        ivs[key] = 0;
        codes.push(`${prefix}_${codeKey}_INVALID`);
        continue;
      }

      const rounded = Math.round(raw);
      const normalized = clamp(rounded, 0, 15);
      if (rounded !== raw) codes.push(`${prefix}_${codeKey}_ROUNDED`);
      if (normalized !== rounded) codes.push(`${prefix}_${codeKey}_CLAMPED`);
      ivs[key] = normalized;
    }

    return {ivs, codes};
  }

  function normalizeBaseStats(pokemon) {
    const source = pokemon && typeof pokemon === 'object'
      ? (pokemon.stats && typeof pokemon.stats === 'object' ? pokemon.stats : pokemon)
      : {};
    const stats = {};
    const codes = [];

    for (const key of IV_KEYS) {
      const raw = toNumber(source[key]);
      const codeKey = key.toUpperCase();
      if (!Number.isFinite(raw)) {
        stats[key] = 0;
        codes.push(`BASE_${codeKey}_INVALID`);
      } else if (raw < 0) {
        stats[key] = 0;
        codes.push(`BASE_${codeKey}_CLAMPED`);
      } else {
        stats[key] = raw;
      }
    }

    return {stats, codes};
  }

  function makeLevelGrid(minimum, maximum, step) {
    const levels = [];
    const count = Math.max(1, Math.floor((maximum - minimum) / step + 1e-9) + 1);
    for (let index = 0; index < count; index += 1) {
      levels.push(Number((minimum + index * step).toFixed(8)));
    }
    if (levels[levels.length - 1] < maximum - 1e-8) levels.push(maximum);
    return levels;
  }

  function createCpmConfig(source) {
    let table = null;
    let cpmAt = null;
    let minimum = 1;
    let maximum = 50;
    let step = 0.5;
    let explicitLevels = null;

    if (Array.isArray(source)) {
      table = source.length ? source : DEFAULT_CPM;
    } else if (typeof source === 'function') {
      cpmAt = source;
    } else if (source && typeof source === 'object') {
      if (Array.isArray(source.cpm)) table = source.cpm;
      else if (Array.isArray(source.values)) table = source.values;
      if (typeof source.cpmAt === 'function') cpmAt = source.cpmAt;
      else if (typeof source.cpm === 'function') cpmAt = source.cpm;

      const requestedMinimum = toNumber(source.minLevel);
      const requestedMaximum = toNumber(source.maxLevel);
      const requestedStep = toNumber(source.step);
      if (Number.isFinite(requestedMinimum)) minimum = requestedMinimum;
      if (Number.isFinite(requestedMaximum)) maximum = requestedMaximum;
      if (Number.isFinite(requestedStep) && requestedStep > 0) step = requestedStep;
      if (Array.isArray(source.levels) && source.levels.length) {
        explicitLevels = source.levels
          .map(toNumber)
          .filter(Number.isFinite)
          .sort((left, right) => left - right);
      }
    } else {
      table = DEFAULT_CPM;
    }

    if (table) {
      if (!table.length) table = DEFAULT_CPM;
      maximum = minimum + (table.length - 1) * step;
    }
    if (maximum < minimum) [minimum, maximum] = [maximum, minimum];

    const levels = explicitLevels || makeLevelGrid(minimum, maximum, step);
    const getter = table
      ? level => table[clamp(Math.round((level - minimum) / step), 0, table.length - 1)]
      : cpmAt;

    return {
      levels,
      getCpm: typeof getter === 'function' ? getter : level => {
        const index = clamp(Math.round((level - 1) * 2), 0, DEFAULT_CPM.length - 1);
        return DEFAULT_CPM[index];
      }
    };
  }

  function normalizeLevelForConfig(input, config) {
    const codes = [];
    const levels = config.levels;
    const raw = toNumber(input);
    if (!Number.isFinite(raw)) {
      return {level: levels[0], codes: ['LEVEL_INVALID']};
    }

    let best = levels[0];
    let bestDistance = Math.abs(raw - best);
    for (let index = 1; index < levels.length; index += 1) {
      const distance = Math.abs(raw - levels[index]);
      if (distance < bestDistance) {
        best = levels[index];
        bestDistance = distance;
      }
    }

    if (raw < levels[0] || raw > levels[levels.length - 1]) codes.push('LEVEL_CLAMPED');
    else if (best !== raw) codes.push('LEVEL_ROUNDED');
    return {level: best, codes};
  }

  function computeStats(pokemon, ivInput, level, config, extraCodes = []) {
    const base = normalizeBaseStats(pokemon);
    const normalizedIvs = normalizeIvs(ivInput);
    const reasonCodes = [...extraCodes, ...base.codes, ...normalizedIvs.codes];
    let cpm;

    try {
      cpm = toNumber(config.getCpm(level));
    } catch (_error) {
      cpm = NaN;
    }
    if (!Number.isFinite(cpm) || cpm <= 0) {
      reasonCodes.push('CPM_INVALID');
      cpm = 0;
    }

    const rawAttack = base.stats.attack + normalizedIvs.ivs.attack;
    const rawDefense = base.stats.defense + normalizedIvs.ivs.defense;
    const rawStamina = base.stats.stamina + normalizedIvs.ivs.stamina;
    const attack = rawAttack * cpm;
    const defense = rawDefense * cpm;
    const hp = Math.max(10, Math.floor(rawStamina * cpm));
    const cp = Math.max(10, Math.floor(
      rawAttack * Math.sqrt(rawDefense) * Math.sqrt(rawStamina) * cpm * cpm / 10
    ));
    const codes = unique(reasonCodes);

    return {
      attack,
      defense,
      hp,
      cp,
      product: attack * defense * hp,
      level,
      cpm,
      ivs: {...normalizedIvs.ivs},
      valid: !codes.some(code => code.endsWith('_INVALID')),
      reasonCodes: codes
    };
  }

  function appraisalFor(ivInput) {
    const normalized = normalizeIvs(ivInput);
    const total = IV_KEYS.reduce((sum, key) => sum + normalized.ivs[key], 0);
    return {
      ivs: {...normalized.ivs},
      total,
      percent: total / 45 * 100,
      stars: total === 45 ? '4★' : total >= 37 ? '3★' : total >= 30 ? '2★' : total >= 23 ? '1★' : '0★',
      valid: !normalized.codes.some(code => code.endsWith('_INVALID')),
      reasonCodes: unique(normalized.codes)
    };
  }

  function statsAt(pokemon, ivInput, levelInput, cpmSource = DEFAULT_CPM) {
    const config = createCpmConfig(cpmSource);
    const normalizedLevel = normalizeLevelForConfig(levelInput, config);
    return computeStats(pokemon, ivInput, normalizedLevel.level, config, normalizedLevel.codes);
  }

  function bestUnderCap(pokemon, ivInput, capInput, cpmSource = DEFAULT_CPM) {
    const config = createCpmConfig(cpmSource);
    const levels = config.levels;
    const capCodes = [];
    let cap = capInput;

    if (cap !== Infinity) {
      cap = toNumber(cap);
      if (!Number.isFinite(cap)) {
        cap = 10;
        capCodes.push('CAP_INVALID');
      } else if (cap < 10) {
        cap = 10;
        capCodes.push('CAP_CLAMPED');
      }
    }

    if (cap === Infinity) {
      return computeStats(pokemon, ivInput, levels[levels.length - 1], config, capCodes);
    }

    let low = 0;
    let high = levels.length - 1;
    let bestIndex = 0;
    let found = false;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const result = computeStats(pokemon, ivInput, levels[middle], config);
      if (result.cp <= cap) {
        found = true;
        bestIndex = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    if (!found) capCodes.push('CAP_BELOW_MINIMUM_CP');
    const result = computeStats(pokemon, ivInput, levels[bestIndex], config, capCodes);
    if (capCodes.includes('CAP_INVALID')) result.valid = false;
    return result;
  }

  function applyStatusModifiers(statsInput, statusInput = 'normal') {
    const source = statsInput && typeof statsInput === 'object' ? statsInput : {};
    const requestedStatus = String(statusInput || 'normal').toLowerCase();
    const status = VALID_STATUSES.includes(requestedStatus) ? requestedStatus : 'normal';
    const modifier = STATUS_MODIFIERS[status];
    const baseAttack = Number.isFinite(toNumber(source.attack)) ? Number(source.attack) : 0;
    const baseDefense = Number.isFinite(toNumber(source.defense)) ? Number(source.defense) : 0;
    const attack = baseAttack * modifier.attack;
    const defense = baseDefense * modifier.defense;
    const inheritedCodes = Array.isArray(source.reasonCodes) ? source.reasonCodes : [];
    const reasonCodes = requestedStatus === status
      ? [...inheritedCodes]
      : [...inheritedCodes, REASON_CODES.STATUS_INVALID];

    return {
      ...source,
      attack,
      defense,
      hp: source.hp,
      cp: source.cp,
      product: attack * defense * (Number.isFinite(toNumber(source.hp)) ? Number(source.hp) : 0),
      baseAttack,
      baseDefense,
      status,
      modifiers: {...modifier},
      valid: source.valid !== false && requestedStatus === status,
      reasonCodes: unique(reasonCodes)
    };
  }

  function purifiedIvs(ivInput) {
    const normalized = normalizeIvs(ivInput).ivs;
    return {
      attack: Math.min(15, normalized.attack + 2),
      defense: Math.min(15, normalized.defense + 2),
      stamina: Math.min(15, normalized.stamina + 2)
    };
  }

  function normalizeStandaloneLevel(levelInput) {
    const raw = toNumber(levelInput);
    if (!Number.isFinite(raw)) return {value: 1, codes: ['LEVEL_INVALID']};
    const clamped = clamp(raw, 1, 50);
    const rounded = roundForStep(clamped, 1, 0.5);
    const codes = [];
    if (clamped !== raw) codes.push('LEVEL_CLAMPED');
    else if (rounded !== raw) codes.push('LEVEL_ROUNDED');
    return {value: rounded, codes};
  }

  function normalizeTrainerLevel(levelInput) {
    const raw = toNumber(levelInput);
    if (!Number.isFinite(raw)) return {value: 25, codes: ['TRAINER_LEVEL_INVALID']};
    const clamped = Math.max(1, raw);
    const rounded = Math.round(clamped);
    const codes = [];
    if (clamped !== raw) codes.push('TRAINER_LEVEL_CLAMPED');
    else if (rounded !== raw) codes.push('TRAINER_LEVEL_ROUNDED');
    return {value: rounded, codes};
  }

  function purifiedLevel(currentLevelInput, trainerLevelInput = 25) {
    const current = normalizeStandaloneLevel(currentLevelInput).value;
    const trainer = normalizeTrainerLevel(trainerLevelInput).value;
    return Math.max(current, Math.min(25, trainer));
  }

  function positiveIntegerOrNull(value) {
    const numeric = toNumber(value);
    return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
  }

  function normalizeStatus(statusInput, fallback) {
    const requested = String(statusInput || fallback).toLowerCase();
    if (VALID_STATUSES.includes(requested)) return {status: requested, codes: []};
    return {status: fallback, codes: [REASON_CODES.STATUS_INVALID]};
  }

  function buildPurificationPlan(options = {}) {
    const pokemon = options.pokemon && typeof options.pokemon === 'object' ? options.pokemon : null;
    const normalizedIvs = normalizeIvs(options.ivs);
    const normalizedLevel = normalizeStandaloneLevel(options.level);
    const normalizedTrainerLevel = normalizeTrainerLevel(options.trainerLevel ?? 25);
    const normalizedStatus = normalizeStatus(options.status, 'shadow');
    const sourceIvs = normalizedIvs.ivs;
    const sourceLevel = normalizedLevel.value;
    const trainerLevel = normalizedTrainerLevel.value;
    const targetIvs = purifiedIvs(sourceIvs);
    const targetLevel = purifiedLevel(sourceLevel, trainerLevel);
    const shadow = pokemon && pokemon.shadow && typeof pokemon.shadow === 'object' ? pokemon.shadow : {};
    const purificationStardust = positiveIntegerOrNull(
      shadow.purificationStardust ?? shadow.purifyStardust ?? pokemon?.purificationStardust
    );
    const purificationCandy = positiveIntegerOrNull(
      shadow.purificationCandy ?? shadow.purifyCandy ?? pokemon?.purificationCandy
    );
    const shadowEligible = Boolean(pokemon && (
      pokemon.shadowEligible === true || (pokemon.shadowEligible !== false && pokemon.shadow)
    ));
    const reasonCodes = [...normalizedStatus.codes];
    const normalizationCodes = unique([
      ...normalizedIvs.codes,
      ...normalizedLevel.codes,
      ...normalizedTrainerLevel.codes
    ]);

    if (!pokemon) reasonCodes.push(REASON_CODES.POKEMON_REQUIRED);
    if (normalizedStatus.status !== 'shadow') reasonCodes.push(REASON_CODES.NOT_SHADOW);
    if (pokemon && !shadowEligible) reasonCodes.push(REASON_CODES.SHADOW_INELIGIBLE);
    if (shadowEligible && (purificationStardust === null || purificationCandy === null)) {
      reasonCodes.push(REASON_CODES.PURIFICATION_COST_MISSING);
    }

    const cpmSource = options.cpmSource ?? options.cpmAt ?? options.cpm ?? DEFAULT_CPM;
    const currentStats = statsAt(pokemon || {}, sourceIvs, sourceLevel, cpmSource);
    const purifiedStats = statsAt(pokemon || {}, targetIvs, targetLevel, cpmSource);
    if (!currentStats.valid || !purifiedStats.valid) reasonCodes.push(REASON_CODES.STAT_CALCULATION_INVALID);

    const eligible = Boolean(
      pokemon && normalizedStatus.status === 'shadow' && shadowEligible && !normalizedStatus.codes.length
    );
    const codes = unique(reasonCodes);

    return {
      eligible,
      valid: eligible && codes.length === 0,
      reasonCodes: codes,
      normalizationCodes,
      rule: shadow.rule || 'standard',
      current: {
        status: 'shadow',
        ivs: {...sourceIvs},
        level: sourceLevel,
        stats: currentStats,
        battleStats: applyStatusModifiers(currentStats, 'shadow')
      },
      purified: {
        status: 'purified',
        ivs: {...targetIvs},
        level: targetLevel,
        stats: purifiedStats,
        battleStats: applyStatusModifiers(purifiedStats, 'purified')
      },
      deltas: {
        attack: targetIvs.attack - sourceIvs.attack,
        defense: targetIvs.defense - sourceIvs.defense,
        stamina: targetIvs.stamina - sourceIvs.stamina,
        level: targetLevel - sourceLevel
      },
      trainerLevel,
      cost: {stardust: purificationStardust, candy: purificationCandy},
      moves: {
        shadow: shadow.shadowMove || 'FRUSTRATION',
        purified: shadow.purifiedMove || 'RETURN'
      }
    };
  }

  function buildTrainingPlan(options = {}) {
    const current = normalizeIvs(options.ivs, 'IV');
    const target = normalizeIvs(options.target ?? current.ivs, 'TARGET_IV');
    const normalizedStatus = normalizeStatus(options.status, 'normal');
    const requestedCapType = String(options.capType || '').toLowerCase();
    const capType = requestedCapType === 'gold' || requestedCapType === 'silver'
      ? requestedCapType
      : 'none';
    const requestedSilverStat = String(options.silverStat || '').toLowerCase();
    const silverStat = IV_KEYS.includes(requestedSilverStat) ? requestedSilverStat : null;
    const requestedPhase = String(options.phase || 'planned').toLowerCase();
    const phase = requestedPhase === 'planned' || requestedPhase === 'completed'
      ? requestedPhase
      : 'planned';
    const reasonCodes = [...normalizedStatus.codes];
    const normalizationCodes = unique([
      ...current.codes,
      ...target.codes,
      ...(requestedPhase === phase ? [] : ['TRAINING_PHASE_INVALID'])
    ]);
    const warningCodes = phase === 'completed' ? ['TRAINING_CHANGES_IRREVERSIBLE'] : [];
    const deltas = {};
    const tasksByStat = {};

    for (const key of IV_KEYS) {
      deltas[key] = target.ivs[key] - current.ivs[key];
      tasksByStat[key] = Math.max(0, deltas[key]);
    }

    if (normalizedStatus.status === 'shadow') reasonCodes.push(REASON_CODES.SHADOW_INELIGIBLE);
    if (IV_KEYS.every(key => current.ivs[key] === 15)) reasonCodes.push(REASON_CODES.ALREADY_PERFECT);
    if (options.goodBuddy !== true) reasonCodes.push(REASON_CODES.GOOD_BUDDY_REQUIRED);
    if (capType === 'none') reasonCodes.push(REASON_CODES.CAP_TYPE_REQUIRED);
    if (current.codes.some(code => code.endsWith('_INVALID'))) reasonCodes.push('CURRENT_IV_INVALID');
    if (target.codes.some(code => code.endsWith('_INVALID'))) reasonCodes.push('TARGET_IV_INVALID');
    if (IV_KEYS.some(key => deltas[key] < 0)) reasonCodes.push(REASON_CODES.TARGET_BELOW_CURRENT);

    const increasingStats = IV_KEYS.filter(key => deltas[key] > 0);
    if (!increasingStats.length) reasonCodes.push(REASON_CODES.NO_INCREASE);

    if (capType === 'silver') {
      if (!silverStat) {
        reasonCodes.push(REASON_CODES.SILVER_STAT_REQUIRED);
      } else {
        if (increasingStats.some(key => key !== silverStat)) {
          reasonCodes.push(REASON_CODES.SILVER_SINGLE_STAT_ONLY);
        }
        if (deltas[silverStat] <= 0) reasonCodes.push(REASON_CODES.SILVER_STAT_NO_INCREASE);
      }
    }

    const eligibilityCodes = new Set([
      REASON_CODES.STATUS_INVALID,
      REASON_CODES.SHADOW_INELIGIBLE,
      REASON_CODES.ALREADY_PERFECT,
      REASON_CODES.GOOD_BUDDY_REQUIRED,
      'CURRENT_IV_INVALID'
    ]);
    const codes = unique(reasonCodes);
    const eligible = !codes.some(code => eligibilityCodes.has(code));
    const totalTasks = IV_KEYS.reduce((sum, key) => sum + tasksByStat[key], 0);

    return {
      eligible,
      valid: codes.length === 0,
      reasonCodes: codes,
      normalizationCodes,
      warningCodes,
      status: normalizedStatus.status,
      capType,
      silverStat,
      phase,
      goodBuddy: options.goodBuddy === true,
      currentIvs: {...current.ivs},
      targetIvs: {...target.ivs},
      deltas: {...deltas},
      tasks: {...tasksByStat, total: totalTasks},
      taskCount: totalTasks
    };
  }

  return Object.freeze({
    DEFAULT_CPM,
    IV_KEYS,
    REASON_CODES,
    STATUS_MODIFIERS,
    appraisalFor,
    statsAt,
    bestUnderCap,
    applyStatusModifiers,
    purifiedIvs,
    purifiedLevel,
    buildPurificationPlan,
    buildTrainingPlan
  });
});
