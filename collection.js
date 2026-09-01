(function installValueDexCollection(factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ValueDexCollection = api;
})(function createValueDexCollection() {
  'use strict';

  const DB_NAME = 'go-valuedex-collection';
  const DB_VERSION = 1;
  const RECORD_VERSION = 1;
  const EXPORT_FORMAT = 'go-valuedex-collection';
  const EXPORT_FORMAT_VERSION = 1;
  const DEFAULT_APP_VERSION = '1.5.0';
  // A maximally sized valid 10,000-record export stays below this bound once
  // the identifier/timestamp limits below are applied, so every backup this
  // version can create remains importable.
  const MAX_IMPORT_BYTES = 256 * 1024 * 1024;
  const MAX_IMPORT_RECORDS = 10000;
  const MAX_IDENTIFIER_LENGTH = 128;
  const MAX_TIMESTAMP_LENGTH = 64;
  const STATUS_VALUES = Object.freeze(['normal', 'shadow', 'purified']);
  const MAX_KIND_VALUES = Object.freeze(['none', 'dynamax', 'gigantamax']);
  const STAT_KEYS = Object.freeze(['attack', 'defense', 'stamina']);
  const MOVE_ID_PATTERN = /^[A-Z0-9_]+$/;
  const SPECIES_KEY_PATTERN = /^\d+:[a-z0-9_]+$/;
  const ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
  const CSV_HEADERS = Object.freeze([
    'format', 'formatVersion', 'recordVersion', 'id', 'revision',
    'speciesKey', 'nicknameJson', 'status', 'attack', 'defense', 'stamina', 'level',
    'fastMove', 'chargedMovesJson', 'maxKind', 'apex', 'favorite',
    'tagsJson', 'noteJson', 'hyperTrainingJson', 'createdAt', 'updatedAt'
  ]);

  class CollectionError extends Error {
    constructor(code, message, details) {
      super(message);
      this.name = 'CollectionError';
      this.code = code;
      if (details !== undefined) this.details = details;
    }
  }

  class CollectionValidationError extends CollectionError {
    constructor(errors, warnings = []) {
      super('VALIDATION_FAILED', '보유 개체 데이터가 올바르지 않습니다.', {errors, warnings});
      this.name = 'CollectionValidationError';
      this.errors = errors;
      this.warnings = warnings;
    }
  }

  function issue(code, path, message, value) {
    const output = {code, path, message};
    if (value !== undefined) output.value = value;
    return output;
  }

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function deepClone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === 'function') {
      try { return structuredClone(value); } catch (_error) { /* JSON fallback */ }
    }
    return JSON.parse(JSON.stringify(value));
  }

  function characterLength(value) {
    return typeof value === 'string' ? [...value].length : NaN;
  }

  function nowValue(now) {
    const value = typeof now === 'function' ? now() : now;
    const date = value instanceof Date ? value : value ? new Date(value) : new Date();
    if (!Number.isFinite(date.getTime())) {
      throw new CollectionError('TIME_INVALID', '현재 시각을 만들 수 없습니다.', value);
    }
    return date.toISOString();
  }

  function defaultUuid() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  }

  function uuidValue(uuid) {
    const value = typeof uuid === 'function' ? uuid() : uuid;
    return String(value || defaultUuid());
  }

  function canonicalTag(value) {
    return String(value).trim().replace(/\s+/g, ' ');
  }

  function canonicalTags(values) {
    if (!Array.isArray(values)) return values;
    const output = [];
    const seen = new Set();
    for (const value of values) {
      const tag = canonicalTag(value);
      const key = tag.toLocaleLowerCase('ko');
      if (tag && !seen.has(key)) {
        seen.add(key);
        output.push(tag);
      }
    }
    return output;
  }

  function canonicalIvs(value) {
    if (!isObject(value)) return value;
    return {
      attack: value.attack,
      defense: value.defense,
      stamina: value.stamina
    };
  }

  function canonicalHyperTraining(value) {
    if (value === null || value === undefined) return null;
    if (!isObject(value)) return value;
    return {
      phase: value.phase,
      capType: value.capType,
      silverStat: value.silverStat === undefined ? null : value.silverStat,
      targetIvs: canonicalIvs(value.targetIvs),
      goodBuddy: value.goodBuddy
    };
  }

  function canonicalRecord(record) {
    return {
      recordVersion: record.recordVersion,
      id: record.id,
      revision: record.revision,
      speciesKey: record.speciesKey,
      nickname: record.nickname,
      status: record.status,
      ivs: canonicalIvs(record.ivs),
      level: record.level,
      moves: isObject(record.moves) ? {
        fast: record.moves.fast === undefined ? null : record.moves.fast,
        charged: Array.isArray(record.moves.charged) ? [...record.moves.charged] : record.moves.charged
      } : record.moves,
      max: isObject(record.max) ? {kind: record.max.kind} : record.max,
      apex: record.apex,
      favorite: record.favorite,
      tags: canonicalTags(record.tags),
      note: record.note,
      hyperTraining: canonicalHyperTraining(record.hyperTraining),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  }

  function isRfc3339(value) {
    if (typeof value !== 'string' || value.length > MAX_TIMESTAMP_LENGTH || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
    return Number.isFinite(Date.parse(value));
  }

  function checkExactKeys(value, expected, path, errors) {
    if (!isObject(value)) return;
    const expectedSet = new Set(expected);
    for (const key of Object.keys(value)) {
      if (!expectedSet.has(key)) errors.push(issue('FIELD_UNKNOWN', `${path}.${key}`, '지원하지 않는 필드입니다.'));
    }
    for (const key of expected) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(issue('FIELD_REQUIRED', `${path}.${key}`, '필수 필드입니다.'));
    }
  }

  function validateIvs(value, path, errors) {
    if (!isObject(value)) {
      errors.push(issue('IVS_INVALID', path, 'IV는 객체여야 합니다.', value));
      return;
    }
    checkExactKeys(value, STAT_KEYS, path, errors);
    for (const key of STAT_KEYS) {
      if (!Number.isInteger(value[key]) || value[key] < 0 || value[key] > 15) {
        errors.push(issue('IV_INVALID', `${path}.${key}`, 'IV는 0부터 15 사이의 정수여야 합니다.', value[key]));
      }
    }
  }

  function validateHyperTraining(value, record, errors, warnings) {
    if (value === null) return;
    if (!isObject(value)) {
      errors.push(issue('TRAINING_INVALID', '$.hyperTraining', '특훈 계획은 객체 또는 null이어야 합니다.', value));
      return;
    }
    checkExactKeys(value, ['phase', 'capType', 'silverStat', 'targetIvs', 'goodBuddy'], '$.hyperTraining', errors);
    if (!['planned', 'completed'].includes(value.phase)) errors.push(issue('TRAINING_PHASE_INVALID', '$.hyperTraining.phase', '특훈 상태는 planned 또는 completed여야 합니다.', value.phase));
    if (!['gold', 'silver'].includes(value.capType)) errors.push(issue('TRAINING_CAP_INVALID', '$.hyperTraining.capType', '병뚜껑 종류가 올바르지 않습니다.', value.capType));
    if (value.capType === 'gold' && value.silverStat !== null) errors.push(issue('TRAINING_SILVER_STAT_UNEXPECTED', '$.hyperTraining.silverStat', '금색병뚜껑에는 단일 능력치를 지정하지 않습니다.', value.silverStat));
    if (value.capType === 'silver' && !STAT_KEYS.includes(value.silverStat)) errors.push(issue('TRAINING_SILVER_STAT_REQUIRED', '$.hyperTraining.silverStat', '은색병뚜껑 능력치를 지정해야 합니다.', value.silverStat));
    if (typeof value.goodBuddy !== 'boolean') errors.push(issue('TRAINING_BUDDY_INVALID', '$.hyperTraining.goodBuddy', '굿 파트너 여부는 boolean이어야 합니다.', value.goodBuddy));
    validateIvs(value.targetIvs, '$.hyperTraining.targetIvs', errors);
    if (isObject(record.ivs) && isObject(value.targetIvs)) {
      let increases = 0;
      for (const key of STAT_KEYS) {
        if (Number.isInteger(record.ivs[key]) && Number.isInteger(value.targetIvs[key])) {
          if (value.targetIvs[key] < record.ivs[key]) errors.push(issue('TRAINING_TARGET_BELOW_CURRENT', `$.hyperTraining.targetIvs.${key}`, '특훈 IV는 현재 IV보다 낮을 수 없습니다.', value.targetIvs[key]));
          if (value.targetIvs[key] > record.ivs[key]) increases += 1;
          if (value.capType === 'silver' && key !== value.silverStat && value.targetIvs[key] !== record.ivs[key]) errors.push(issue('TRAINING_SILVER_MULTI_STAT', `$.hyperTraining.targetIvs.${key}`, '은색병뚜껑은 선택한 능력치 하나만 올릴 수 있습니다.', value.targetIvs[key]));
        }
      }
      if (!increases) errors.push(issue('TRAINING_NO_INCREASE', '$.hyperTraining.targetIvs', '현재 IV보다 높은 목표가 하나 이상 필요합니다.'));
    }
    if (record.status === 'shadow') errors.push(issue('TRAINING_SHADOW_INVALID', '$.hyperTraining', '그림자 포켓몬에는 특훈 계획을 저장할 수 없습니다.'));
    if (!value.goodBuddy) warnings.push(issue('TRAINING_BUDDY_REQUIRED', '$.hyperTraining.goodBuddy', '실제 특훈에는 굿 파트너 이상이 필요합니다.'));
  }

  function validateRecord(record) {
    const errors = [];
    const warnings = [];
    if (!isObject(record)) {
      return {valid: false, errors: [issue('RECORD_INVALID', '$', '레코드는 객체여야 합니다.', record)], warnings};
    }
    const keys = ['recordVersion', 'id', 'revision', 'speciesKey', 'nickname', 'status', 'ivs', 'level', 'moves', 'max', 'apex', 'favorite', 'tags', 'note', 'hyperTraining', 'createdAt', 'updatedAt'];
    checkExactKeys(record, keys, '$', errors);
    if (record.recordVersion !== RECORD_VERSION) errors.push(issue('RECORD_VERSION_UNSUPPORTED', '$.recordVersion', `지원하는 레코드 버전은 ${RECORD_VERSION}입니다.`, record.recordVersion));
    if (typeof record.id !== 'string' || !ID_PATTERN.test(record.id) || record.id.length > MAX_IDENTIFIER_LENGTH) errors.push(issue('ID_INVALID', '$.id', 'ID 형식이 올바르지 않습니다.', record.id));
    if (!Number.isSafeInteger(record.revision) || record.revision < 1) errors.push(issue('REVISION_INVALID', '$.revision', 'revision은 1 이상의 안전한 정수여야 합니다.', record.revision));
    if (typeof record.speciesKey !== 'string' || record.speciesKey.length > MAX_IDENTIFIER_LENGTH || !SPECIES_KEY_PATTERN.test(record.speciesKey)) errors.push(issue('SPECIES_KEY_INVALID', '$.speciesKey', 'speciesKey 형식이 올바르지 않습니다.', record.speciesKey));
    if (typeof record.nickname !== 'string' || characterLength(record.nickname) > 40) errors.push(issue('NICKNAME_INVALID', '$.nickname', '별명은 40자 이하의 문자열이어야 합니다.', typeof record.nickname === 'string' ? characterLength(record.nickname) : record.nickname));
    if (!STATUS_VALUES.includes(record.status)) errors.push(issue('STATUS_INVALID', '$.status', '상태 값이 올바르지 않습니다.', record.status));
    validateIvs(record.ivs, '$.ivs', errors);
    if (!Number.isFinite(record.level) || record.level < 1 || record.level > 50 || !Number.isInteger(record.level * 2)) errors.push(issue('LEVEL_INVALID', '$.level', '레벨은 1부터 50까지 0.5 단위여야 합니다.', record.level));

    if (!isObject(record.moves)) errors.push(issue('MOVES_INVALID', '$.moves', '기술은 객체여야 합니다.', record.moves));
    else {
      checkExactKeys(record.moves, ['fast', 'charged'], '$.moves', errors);
      if (record.moves.fast !== null && (typeof record.moves.fast !== 'string' || record.moves.fast.length > MAX_IDENTIFIER_LENGTH || !MOVE_ID_PATTERN.test(record.moves.fast))) errors.push(issue('FAST_MOVE_INVALID', '$.moves.fast', '노말 기술 ID 형식이 올바르지 않습니다.', record.moves.fast));
      if (!Array.isArray(record.moves.charged)) errors.push(issue('CHARGED_MOVES_INVALID', '$.moves.charged', '차지 기술은 배열이어야 합니다.', record.moves.charged));
      else {
        if (record.moves.charged.length > 2) errors.push(issue('CHARGED_MOVES_LIMIT', '$.moves.charged', '차지 기술은 최대 2개까지 저장할 수 있습니다.', record.moves.charged.length));
        if (new Set(record.moves.charged).size !== record.moves.charged.length) errors.push(issue('CHARGED_MOVES_DUPLICATE', '$.moves.charged', '차지 기술이 중복되었습니다.'));
        record.moves.charged.forEach((move, index) => {
          if (typeof move !== 'string' || move.length > MAX_IDENTIFIER_LENGTH || !MOVE_ID_PATTERN.test(move)) errors.push(issue('CHARGED_MOVE_INVALID', `$.moves.charged[${index}]`, '차지 기술 ID 형식이 올바르지 않습니다.', move));
        });
      }
    }

    if (!isObject(record.max)) errors.push(issue('MAX_INVALID', '$.max', '맥스 자격은 객체여야 합니다.', record.max));
    else {
      checkExactKeys(record.max, ['kind'], '$.max', errors);
      if (!MAX_KIND_VALUES.includes(record.max.kind)) errors.push(issue('MAX_KIND_INVALID', '$.max.kind', '맥스 종류가 올바르지 않습니다.', record.max.kind));
    }
    if (typeof record.apex !== 'boolean') errors.push(issue('APEX_INVALID', '$.apex', 'APEX 여부는 boolean이어야 합니다.', record.apex));
    if (record.apex === true && record.status !== 'shadow') errors.push(issue('APEX_STATUS_INVALID', '$.apex', 'APEX 개체는 그림자 상태여야 합니다.'));
    if (record.status === 'shadow' && isObject(record.max) && record.max.kind !== 'none') errors.push(issue('SHADOW_MAX_INVALID', '$.max.kind', '그림자 포켓몬은 맥스 자격을 가질 수 없습니다.', record.max.kind));
    if (typeof record.favorite !== 'boolean') errors.push(issue('FAVORITE_INVALID', '$.favorite', '즐겨찾기는 boolean이어야 합니다.', record.favorite));

    if (!Array.isArray(record.tags)) errors.push(issue('TAGS_INVALID', '$.tags', '태그는 배열이어야 합니다.', record.tags));
    else {
      if (record.tags.length > 20) errors.push(issue('TAGS_LIMIT', '$.tags', '태그는 최대 20개까지 저장할 수 있습니다.', record.tags.length));
      const normalized = [];
      record.tags.forEach((tag, index) => {
        if (typeof tag !== 'string' || !canonicalTag(tag) || characterLength(canonicalTag(tag)) > 32) errors.push(issue('TAG_INVALID', `$.tags[${index}]`, '태그는 1~32자의 문자열이어야 합니다.', tag));
        else normalized.push(canonicalTag(tag).toLocaleLowerCase('ko'));
        if (typeof tag === 'string' && tag !== canonicalTag(tag)) errors.push(issue('TAG_NOT_NORMALIZED', `$.tags[${index}]`, '태그 앞뒤·연속 공백을 정리해야 합니다.', tag));
      });
      if (new Set(normalized).size !== normalized.length) errors.push(issue('TAGS_DUPLICATE', '$.tags', '대소문자를 제외하고 같은 태그가 중복되었습니다.'));
    }
    if (typeof record.note !== 'string' || characterLength(record.note) > 2000) errors.push(issue('NOTE_INVALID', '$.note', '메모는 2,000자 이하의 문자열이어야 합니다.', typeof record.note === 'string' ? characterLength(record.note) : record.note));
    validateHyperTraining(record.hyperTraining, record, errors, warnings);
    if (!isRfc3339(record.createdAt)) errors.push(issue('CREATED_AT_INVALID', '$.createdAt', 'createdAt은 시간대가 있는 RFC 3339 시각이어야 합니다.', record.createdAt));
    if (!isRfc3339(record.updatedAt)) errors.push(issue('UPDATED_AT_INVALID', '$.updatedAt', 'updatedAt은 시간대가 있는 RFC 3339 시각이어야 합니다.', record.updatedAt));
    if (isRfc3339(record.createdAt) && isRfc3339(record.updatedAt) && Date.parse(record.updatedAt) < Date.parse(record.createdAt)) errors.push(issue('UPDATED_BEFORE_CREATED', '$.updatedAt', 'updatedAt은 createdAt보다 빠를 수 없습니다.', record.updatedAt));
    return {valid: errors.length === 0, errors, warnings};
  }

  function findPokemon(catalog, speciesKey) {
    if (!catalog) return null;
    if (catalog instanceof Map) return catalog.get(speciesKey) || null;
    if (Array.isArray(catalog)) return catalog.find(value => value && value.speciesKey === speciesKey) || null;
    return catalog[speciesKey] || null;
  }

  function findMove(catalog, moveId) {
    if (!catalog || !moveId) return null;
    if (catalog instanceof Map) return catalog.get(moveId) || null;
    if (Array.isArray(catalog)) return catalog.find(value => value && value.id === moveId) || null;
    return catalog[moveId] || null;
  }

  function auditRecord(record, pokemonCatalog, moveCatalog) {
    const warnings = [];
    const pokemon = findPokemon(pokemonCatalog, record && record.speciesKey);
    if (!pokemon) {
      warnings.push(issue('SPECIES_NOT_FOUND', '$.speciesKey', '현재 도감에서 이 폼을 찾을 수 없지만 기록은 보존됩니다.', record && record.speciesKey));
      return {valid: true, warnings};
    }
    if (record.status !== 'normal' && !pokemon.shadowEligible) warnings.push(issue('STATUS_NOT_CURRENTLY_SUPPORTED', '$.status', '현재 데이터에서는 이 종의 그림자·정화 상태가 확인되지 않습니다.', record.status));
    if (record.apex && !['249:normal', '250:normal'].includes(record.speciesKey)) warnings.push(issue('APEX_SPECIES_MISMATCH', '$.apex', 'APEX는 루기아 또는 칠색조 기록에만 적용됩니다.'));
    if (record.max && record.max.kind === 'dynamax' && !pokemon.dynamax) warnings.push(issue('DYNAMAX_NOT_SUPPORTED', '$.max.kind', '현재 데이터에서 이 폼의 다이맥스 자격이 확인되지 않습니다.'));
    if (record.max && record.max.kind === 'gigantamax' && !pokemon.gigantamax) warnings.push(issue('GIGANTAMAX_NOT_SUPPORTED', '$.max.kind', '현재 데이터에서 이 폼의 거다이맥스 자격이 확인되지 않습니다.'));

    const fastIds = new Set((pokemon.moves && pokemon.moves.fast || []).map(move => move.id));
    const chargedIds = new Set((pokemon.moves && pokemon.moves.charged || []).map(move => move.id));
    if (record.moves && record.moves.fast && !fastIds.has(record.moves.fast)) {
      const known = findMove(moveCatalog, record.moves.fast);
      warnings.push(issue(
        known ? 'FAST_MOVE_NOT_IN_POOL' : 'FAST_MOVE_NOT_FOUND',
        '$.moves.fast',
        known ? '현재 이 폼의 노말 기술 목록에 포함되지 않지만 기록은 보존됩니다.' : '현재 기술 데이터에서 노말 기술을 찾을 수 없지만 기록은 보존됩니다.',
        record.moves.fast
      ));
    }
    for (const [index, move] of (record.moves && record.moves.charged || []).entries()) {
      const shadowMoves = ['FRUSTRATION', 'AEROBLAST_PLUS', 'SACRED_FIRE_PLUS'];
      const purifiedMoves = ['RETURN', 'AEROBLAST_PLUS_PLUS', 'SACRED_FIRE_PLUS_PLUS'];
      const validStatusMove = (record.status === 'shadow' && shadowMoves.includes(move)) || (record.status === 'purified' && purifiedMoves.includes(move));
      if (!chargedIds.has(move) && !validStatusMove) {
        const known = findMove(moveCatalog, move);
        warnings.push(issue(
          known ? 'CHARGED_MOVE_NOT_IN_POOL' : 'CHARGED_MOVE_NOT_FOUND',
          `$.moves.charged[${index}]`,
          known ? '현재 이 폼의 차지 기술 목록에 포함되지 않지만 기록은 보존됩니다.' : '현재 기술 데이터에서 차지 기술을 찾을 수 없지만 기록은 보존됩니다.',
          move
        ));
      }
    }
    return {valid: true, warnings};
  }

  function migrateV0(input, options) {
    const timestamp = input.createdAt || input.updatedAt || nowValue(options.now);
    const status = input.status || input.condition || 'normal';
    let maxKind = input.maxKind || (isObject(input.max) && input.max.kind);
    if (!maxKind) {
      if (input.gigantamax === true) maxKind = 'gigantamax';
      else if (input.maxEligible === true) maxKind = 'dynamax';
      else maxKind = 'none';
    }
    const sourceIvs = input.ivs || {attack: input.attackIv, defense: input.defenseIv, stamina: input.staminaIv};
    const sourceMoves = input.moves || {fast: input.fastMove ?? null, charged: input.chargedMoves || []};
    const training = input.hyperTraining || input.training || null;
    const migratedTraining = training && training.capType && training.capType !== 'none' ? {
      phase: training.phase || 'planned',
      capType: training.capType,
      silverStat: training.capType === 'silver' ? (training.silverStat || 'attack') : null,
      targetIvs: canonicalIvs(training.targetIvs || training.target || sourceIvs),
      goodBuddy: training.goodBuddy === true
    } : null;
    return {
      recordVersion: RECORD_VERSION,
      id: input.id || uuidValue(options.uuid),
      revision: Number.isInteger(input.revision) && input.revision > 0 ? input.revision : 1,
      speciesKey: input.speciesKey,
      nickname: typeof input.nickname === 'string' ? input.nickname : '',
      status,
      ivs: canonicalIvs(sourceIvs),
      level: input.level,
      moves: {
        fast: sourceMoves.fast === undefined ? null : sourceMoves.fast,
        charged: Array.isArray(sourceMoves.charged) ? [...sourceMoves.charged] : []
      },
      max: {kind: maxKind},
      apex: input.apex === true,
      favorite: input.favorite === true,
      tags: canonicalTags(input.tags || []),
      note: typeof input.note === 'string' ? input.note : '',
      hyperTraining: migratedTraining,
      createdAt: timestamp,
      updatedAt: input.updatedAt || timestamp
    };
  }

  const RECORD_MIGRATIONS = Object.freeze({0: migrateV0});

  function migrateRecord(input, options = {}) {
    if (!isObject(input)) throw new CollectionValidationError([issue('RECORD_INVALID', '$', '레코드는 객체여야 합니다.', input)]);
    let record = deepClone(input);
    let version = record.recordVersion;
    if (version === undefined || version === null) version = 0;
    if (!Number.isInteger(version) || version < 0) throw new CollectionError('RECORD_VERSION_INVALID', '레코드 버전이 올바르지 않습니다.', version);
    if (version > RECORD_VERSION) throw new CollectionError('UNSUPPORTED_FUTURE_VERSION', `이 앱보다 새로운 레코드 버전 ${version}입니다.`, version);
    while (version < RECORD_VERSION) {
      const migrate = RECORD_MIGRATIONS[version];
      if (!migrate) throw new CollectionError('MIGRATION_MISSING', `${version} 버전 마이그레이션을 찾을 수 없습니다.`, version);
      record = migrate(record, options);
      version = record.recordVersion;
    }
    const result = validateRecord(record);
    if (!result.valid) throw new CollectionValidationError(result.errors, result.warnings);
    return canonicalRecord(record);
  }

  function normalizeMoves(moves) {
    const value = moves || {};
    return {
      fast: value.fast === undefined || value.fast === '' ? null : value.fast,
      charged: Array.isArray(value.charged) ? [...value.charged] : []
    };
  }

  function determineMaxKind(pokemon, state, options) {
    if (options.maxKind) return options.maxKind;
    if (state.maxKind) return state.maxKind;
    if (!state.maxEligible) return 'none';
    if (pokemon.dynamax) return 'dynamax';
    if (pokemon.gigantamax) return 'gigantamax';
    return 'dynamax';
  }

  function createRecordFromState(pokemon, state, options = {}) {
    if (!pokemon || !pokemon.speciesKey) throw new CollectionError('POKEMON_REQUIRED', 'speciesKey가 있는 포켓몬이 필요합니다.');
    const source = state || {};
    const timestamp = nowValue(options.now);
    const training = options.hyperTraining !== undefined ? options.hyperTraining : source.training;
    const hyperTraining = training && training.capType && training.capType !== 'none' ? {
      phase: training.phase || 'planned',
      capType: training.capType,
      silverStat: training.capType === 'silver' ? (training.silverStat || 'attack') : null,
      targetIvs: canonicalIvs(training.targetIvs || training.target),
      goodBuddy: training.goodBuddy === true
    } : null;
    const record = {
      recordVersion: RECORD_VERSION,
      id: uuidValue(options.uuid),
      revision: 1,
      speciesKey: pokemon.speciesKey,
      nickname: typeof options.nickname === 'string' ? options.nickname : '',
      status: source.status || source.condition || 'normal',
      ivs: canonicalIvs(source.ivs),
      level: source.level,
      moves: normalizeMoves(options.moves !== undefined ? options.moves : source.moves),
      max: {kind: determineMaxKind(pokemon, source, options)},
      apex: source.apex === true,
      favorite: options.favorite === true,
      tags: canonicalTags(options.tags || []),
      note: typeof options.note === 'string' ? options.note : '',
      hyperTraining,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const result = validateRecord(record);
    if (!result.valid) throw new CollectionValidationError(result.errors, result.warnings);
    return canonicalRecord(record);
  }

  function recordToSnapshot(record, options = {}) {
    const valid = validateRecord(record);
    if (!valid.valid) throw new CollectionValidationError(valid.errors, valid.warnings);
    const trainingMode = options.training || 'effective';
    const useTarget = record.hyperTraining && (
      trainingMode === 'target' || (trainingMode === 'effective' && record.hyperTraining.phase === 'completed')
    );
    return {
      ivs: canonicalIvs(useTarget ? record.hyperTraining.targetIvs : record.ivs),
      level: record.level,
      status: record.status,
      maxEligible: record.max.kind !== 'none',
      maxKind: record.max.kind
    };
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (isObject(value)) {
      const output = {};
      for (const key of Object.keys(value).sort()) output[key] = stableValue(value[key]);
      return output;
    }
    return value;
  }

  function stableStringify(value) {
    return JSON.stringify(stableValue(value));
  }

  async function sha256Hex(text) {
    const bytes = new TextEncoder().encode(text);
    if (globalThis.crypto && globalThis.crypto.subtle) {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    }
    if (typeof require === 'function') {
      const crypto = require('node:crypto');
      return crypto.createHash('sha256').update(bytes).digest('hex');
    }
    throw new CollectionError('DIGEST_UNAVAILABLE', 'SHA-256 기능을 사용할 수 없습니다.');
  }

  function prepareRecords(records, options = {}) {
    if (!Array.isArray(records)) throw new CollectionError('RECORDS_INVALID', 'records는 배열이어야 합니다.');
    if (records.length > (options.maxRecords ?? MAX_IMPORT_RECORDS)) throw new CollectionError('RECORD_LIMIT_EXCEEDED', '가져올 수 있는 보유 개체 수를 초과했습니다.', records.length);
    const output = [];
    const ids = new Set();
    const warnings = [];
    for (const input of records) {
      const record = migrateRecord(input, options);
      if (ids.has(record.id)) throw new CollectionError('DUPLICATE_ID', `중복 ID가 있습니다: ${record.id}`, record.id);
      ids.add(record.id);
      output.push(record);
      warnings.push(...validateRecord(record).warnings);
    }
    return {records: output, warnings};
  }

  async function serializeJSON(records, metadata = {}, options = {}) {
    const prepared = prepareRecords(records, options);
    const exportedAt = nowValue(options.now || metadata.exportedAt);
    const integrityValue = await sha256Hex(stableStringify(prepared.records));
    const envelope = {
      format: EXPORT_FORMAT,
      formatVersion: EXPORT_FORMAT_VERSION,
      exportedAt,
      appVersion: String(metadata.appVersion || DEFAULT_APP_VERSION),
      dataSnapshots: deepClone(metadata.dataSnapshots || {}),
      recordCount: prepared.records.length,
      records: prepared.records,
      integrity: {algorithm: 'SHA-256', digest: integrityValue}
    };
    return JSON.stringify(envelope, null, options.pretty === false ? 0 : 2) + '\n';
  }

  function importTextGuard(text, options) {
    if (typeof text !== 'string') throw new CollectionError('IMPORT_TEXT_INVALID', '가져오기 내용은 문자열이어야 합니다.');
    const bytes = new TextEncoder().encode(text).byteLength;
    if (bytes > (options.maxBytes ?? MAX_IMPORT_BYTES)) throw new CollectionError('IMPORT_SIZE_EXCEEDED', '가져오기 파일이 너무 큽니다.', bytes);
  }

  async function parseJSON(text, options = {}) {
    importTextGuard(text, options);
    let envelope;
    try { envelope = JSON.parse(text); } catch (error) { throw new CollectionError('JSON_PARSE_FAILED', 'JSON 파일을 읽을 수 없습니다.', error.message); }
    if (Array.isArray(envelope)) envelope = {format: EXPORT_FORMAT, formatVersion: 0, records: envelope};
    if (!isObject(envelope) || envelope.format !== EXPORT_FORMAT) throw new CollectionError('EXPORT_FORMAT_INVALID', 'GO ValueDex 보유함 JSON이 아닙니다.');
    const formatVersion = envelope.formatVersion === undefined ? 0 : envelope.formatVersion;
    if (!Number.isInteger(formatVersion) || formatVersion < 0) throw new CollectionError('EXPORT_VERSION_INVALID', '내보내기 버전이 올바르지 않습니다.', formatVersion);
    if (formatVersion > EXPORT_FORMAT_VERSION) throw new CollectionError('UNSUPPORTED_EXPORT_VERSION', `이 앱보다 새로운 내보내기 버전 ${formatVersion}입니다.`, formatVersion);
    if (!Array.isArray(envelope.records)) throw new CollectionError('RECORDS_INVALID', 'records 배열이 없습니다.');
    if (formatVersion === 1) {
      if (!isRfc3339(envelope.exportedAt)) throw new CollectionError('EXPORTED_AT_INVALID', 'exportedAt은 RFC 3339 시각이어야 합니다.', envelope.exportedAt);
      if (typeof envelope.appVersion !== 'string' || !envelope.appVersion) throw new CollectionError('APP_VERSION_INVALID', 'appVersion이 올바르지 않습니다.', envelope.appVersion);
      if (!isObject(envelope.dataSnapshots)) throw new CollectionError('DATA_SNAPSHOTS_INVALID', 'dataSnapshots는 객체여야 합니다.', envelope.dataSnapshots);
      if (!Number.isInteger(envelope.recordCount) || envelope.recordCount !== envelope.records.length) throw new CollectionError('RECORD_COUNT_MISMATCH', 'recordCount와 실제 레코드 수가 다릅니다.');
      if (!isObject(envelope.integrity) || envelope.integrity.algorithm !== 'SHA-256' || !/^[a-f0-9]{64}$/.test(envelope.integrity.digest || '')) throw new CollectionError('INTEGRITY_INVALID', 'JSON 무결성 정보가 올바르지 않습니다.');
      const actual = await sha256Hex(stableStringify(envelope.records));
      if (actual !== envelope.integrity.digest) throw new CollectionError('INTEGRITY_MISMATCH', 'JSON 레코드가 내보낸 뒤 변경되었거나 손상되었습니다.');
    }
    const prepared = prepareRecords(envelope.records, options);
    return {
      records: prepared.records,
      warnings: prepared.warnings,
      metadata: {
        formatVersion,
        exportedAt: envelope.exportedAt || null,
        appVersion: envelope.appVersion || null,
        dataSnapshots: deepClone(envelope.dataSnapshots || {})
      }
    };
  }

  function csvEscape(value) {
    return `"${String(value === null || value === undefined ? '' : value).replace(/"/g, '""')}"`;
  }

  function serializeCSV(records, _metadata = {}, options = {}) {
    const prepared = prepareRecords(records, options).records;
    const rows = [CSV_HEADERS];
    for (const record of prepared) rows.push([
      EXPORT_FORMAT,
      EXPORT_FORMAT_VERSION,
      record.recordVersion,
      record.id,
      record.revision,
      record.speciesKey,
      JSON.stringify(record.nickname),
      record.status,
      record.ivs.attack,
      record.ivs.defense,
      record.ivs.stamina,
      record.level,
      record.moves.fast || '',
      JSON.stringify(record.moves.charged),
      record.max.kind,
      String(record.apex),
      String(record.favorite),
      JSON.stringify(record.tags),
      JSON.stringify(record.note),
      JSON.stringify(record.hyperTraining),
      record.createdAt,
      record.updatedAt
    ]);
    return rows.map(row => row.map(csvEscape).join(',')).join('\r\n') + '\r\n';
  }

  function parseCsvRows(text, maxRows = MAX_IMPORT_RECORDS + 1) {
    const input = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    let afterQuote = false;
    const commitRow = () => {
      row.push(cell);
      rows.push(row);
      if (rows.length > maxRows) throw new CollectionError('RECORD_LIMIT_EXCEEDED', '가져올 수 있는 보유 개체 수를 초과했습니다.', rows.length - 1);
      row = [];
      cell = '';
    };
    for (let index = 0; index < input.length; index += 1) {
      const char = input[index];
      if (quoted) {
        if (char === '"') {
          if (input[index + 1] === '"') { cell += '"'; index += 1; }
          else { quoted = false; afterQuote = true; }
        } else cell += char;
        continue;
      }
      if (afterQuote) {
        if (char === ',') { row.push(cell); cell = ''; afterQuote = false; }
        else if (char === '\n' || char === '\r') {
          commitRow(); afterQuote = false;
          if (char === '\r' && input[index + 1] === '\n') index += 1;
        } else throw new CollectionError('CSV_PARSE_FAILED', '닫는 따옴표 뒤에 잘못된 문자가 있습니다.', {index, char});
        continue;
      }
      if (char === '"') {
        if (cell) throw new CollectionError('CSV_PARSE_FAILED', '셀 중간에서 따옴표가 시작되었습니다.', {index});
        quoted = true;
      } else if (char === ',') { row.push(cell); cell = ''; }
      else if (char === '\n' || char === '\r') {
        commitRow();
        if (char === '\r' && input[index + 1] === '\n') index += 1;
      } else cell += char;
    }
    if (quoted) throw new CollectionError('CSV_PARSE_FAILED', '닫히지 않은 따옴표가 있습니다.');
    if (afterQuote || cell || row.length) commitRow();
    while (rows.length && rows[rows.length - 1].every(value => value === '')) rows.pop();
    return rows;
  }

  function parseJsonCell(value, path) {
    try { return JSON.parse(value); } catch (error) { throw new CollectionError('CSV_JSON_CELL_INVALID', `${path} 셀의 JSON을 읽을 수 없습니다.`, error.message); }
  }

  function parseCsvBoolean(value, path) {
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new CollectionError('CSV_BOOLEAN_INVALID', `${path} 값은 true 또는 false여야 합니다.`, value);
  }

  function parseCsvNumber(value, path) {
    if (typeof value !== 'string' || !value.trim() || !Number.isFinite(Number(value))) throw new CollectionError('CSV_NUMBER_INVALID', `${path} 값은 숫자여야 합니다.`, value);
    return Number(value);
  }

  function parseCSV(text, options = {}) {
    importTextGuard(text, options);
    const rows = parseCsvRows(text, (options.maxRecords ?? MAX_IMPORT_RECORDS) + 1);
    if (!rows.length) throw new CollectionError('CSV_EMPTY', 'CSV가 비어 있습니다.');
    if (rows[0].length !== CSV_HEADERS.length || rows[0].some((value, index) => value !== CSV_HEADERS[index])) throw new CollectionError('CSV_HEADER_INVALID', 'CSV 헤더 또는 열 순서가 올바르지 않습니다.', rows[0]);
    const records = [];
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      if (row.length !== CSV_HEADERS.length) throw new CollectionError('CSV_COLUMN_COUNT_INVALID', `${rowIndex + 1}행의 열 수가 올바르지 않습니다.`, row.length);
      const value = Object.fromEntries(CSV_HEADERS.map((header, index) => [header, row[index]]));
      if (value.format !== EXPORT_FORMAT) throw new CollectionError('EXPORT_FORMAT_INVALID', `${rowIndex + 1}행의 형식이 올바르지 않습니다.`, value.format);
      const formatVersion = parseCsvNumber(value.formatVersion, 'formatVersion');
      if (!Number.isInteger(formatVersion) || formatVersion < 0 || formatVersion > EXPORT_FORMAT_VERSION) throw new CollectionError('UNSUPPORTED_EXPORT_VERSION', `${rowIndex + 1}행의 내보내기 버전을 지원하지 않습니다.`, value.formatVersion);
      records.push({
        recordVersion: parseCsvNumber(value.recordVersion, 'recordVersion'),
        id: value.id,
        revision: parseCsvNumber(value.revision, 'revision'),
        speciesKey: value.speciesKey,
        nickname: parseJsonCell(value.nicknameJson, 'nicknameJson'),
        status: value.status,
        ivs: {
          attack: parseCsvNumber(value.attack, 'attack'),
          defense: parseCsvNumber(value.defense, 'defense'),
          stamina: parseCsvNumber(value.stamina, 'stamina')
        },
        level: parseCsvNumber(value.level, 'level'),
        moves: {fast: value.fastMove || null, charged: parseJsonCell(value.chargedMovesJson, 'chargedMovesJson')},
        max: {kind: value.maxKind},
        apex: parseCsvBoolean(value.apex, 'apex'),
        favorite: parseCsvBoolean(value.favorite, 'favorite'),
        tags: parseJsonCell(value.tagsJson, 'tagsJson'),
        note: parseJsonCell(value.noteJson, 'noteJson'),
        hyperTraining: parseJsonCell(value.hyperTrainingJson, 'hyperTrainingJson'),
        createdAt: value.createdAt,
        updatedAt: value.updatedAt
      });
    }
    const prepared = prepareRecords(records, options);
    return {records: prepared.records, warnings: prepared.warnings, metadata: {formatVersion: EXPORT_FORMAT_VERSION}};
  }

  function compareUpdated(left, right) {
    const revisionDifference = left.revision - right.revision;
    return revisionDifference || Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
  }

  function planImport(existingInput, incomingInput, options = {}) {
    const mode = options.mode || 'merge';
    const conflict = options.conflict || 'newer';
    if (!['merge', 'replace'].includes(mode)) throw new CollectionError('IMPORT_MODE_INVALID', '가져오기 모드는 merge 또는 replace여야 합니다.', mode);
    if (!['newer', 'incoming', 'skip', 'error'].includes(conflict)) throw new CollectionError('CONFLICT_POLICY_INVALID', '충돌 정책이 올바르지 않습니다.', conflict);
    const incoming = prepareRecords(incomingInput || [], options).records;
    if (mode === 'replace') return {
      records: incoming.map(deepClone),
      report: {mode, added: incoming.length, updated: 0, skipped: 0, removed: Array.isArray(existingInput) ? existingInput.length : 0, conflicts: []}
    };
    const existing = prepareRecords(existingInput || [], options).records;
    const output = existing.map(deepClone);
    const positions = new Map(output.map((record, index) => [record.id, index]));
    const report = {mode, added: 0, updated: 0, skipped: 0, removed: 0, conflicts: []};
    for (const record of incoming) {
      const index = positions.get(record.id);
      if (index === undefined) {
        positions.set(record.id, output.length);
        output.push(deepClone(record));
        report.added += 1;
        continue;
      }
      const current = output[index];
      if (stableStringify(current) === stableStringify(record)) { report.skipped += 1; continue; }
      const conflictItem = {id: record.id, existingRevision: current.revision, incomingRevision: record.revision};
      report.conflicts.push(conflictItem);
      if (conflict === 'error') throw new CollectionError('IMPORT_CONFLICT', `ID가 충돌했습니다: ${record.id}`, conflictItem);
      const shouldReplace = conflict === 'incoming' || (conflict === 'newer' && compareUpdated(record, current) > 0);
      if (shouldReplace) {
        if (current.revision >= Number.MAX_SAFE_INTEGER) throw new CollectionError('REVISION_EXHAUSTED', `revision을 더 올릴 수 없습니다: ${record.id}`, conflictItem);
        const replacement = deepClone(record);
        replacement.revision = Math.max(replacement.revision, current.revision + 1);
        output[index] = replacement;
        report.updated += 1;
      }
      else report.skipped += 1;
    }
    if (output.length > (options.maxRecords ?? MAX_IMPORT_RECORDS)) throw new CollectionError('RECORD_LIMIT_EXCEEDED', '병합 후 보유 개체 수가 저장 한도를 초과합니다.', output.length);
    return {records: output, report};
  }

  function requestPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new CollectionError('IDB_REQUEST_FAILED', 'IndexedDB 요청이 실패했습니다.'));
    });
  }

  function transactionPromise(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new CollectionError('IDB_TRANSACTION_ABORTED', 'IndexedDB 트랜잭션이 취소되었습니다.'));
      transaction.onerror = () => { /* onabort supplies the final failure */ };
    });
  }

  function installDatabaseVersion(database, oldVersion) {
    if (oldVersion < 1) {
      const specimens = database.createObjectStore('specimens', {keyPath: 'id'});
      specimens.createIndex('bySpeciesKey', 'speciesKey', {unique: false});
      specimens.createIndex('byStatus', 'status', {unique: false});
      specimens.createIndex('byMaxKind', 'max.kind', {unique: false});
      specimens.createIndex('byUpdatedAt', 'updatedAt', {unique: false});
      specimens.createIndex('byTag', 'tags', {unique: false, multiEntry: true});
      database.createObjectStore('meta', {keyPath: 'key'});
    }
  }

  function openDatabase(indexedDBFactory, name = DB_NAME) {
    return new Promise((resolve, reject) => {
      let request;
      let settled = false;
      const fail = error => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      try { request = indexedDBFactory.open(name, DB_VERSION); }
      catch (error) { fail(new CollectionError('IDB_OPEN_FAILED', 'IndexedDB를 열 수 없습니다.', error)); return; }
      request.onupgradeneeded = event => {
        try { installDatabaseVersion(request.result, event.oldVersion); }
        catch (error) { request.transaction.abort(); fail(error); }
      };
      request.onerror = () => fail(request.error || new CollectionError('IDB_OPEN_FAILED', 'IndexedDB를 열 수 없습니다.'));
      request.onblocked = () => fail(new CollectionError('IDB_BLOCKED', '다른 탭이 이전 데이터베이스를 사용 중입니다. 다른 탭을 닫고 다시 시도하세요.'));
      request.onsuccess = () => {
        if (settled) { request.result.close(); return; }
        settled = true;
        resolve(request.result);
      };
    });
  }

  function migrateStoredRecords(database, options) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(['specimens', 'meta'], 'readwrite');
      const store = transaction.objectStore('specimens');
      const cursorRequest = store.openCursor();
      let recoveryCount = 0;
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          transaction.objectStore('meta').put({key: 'schema', dbVersion: DB_VERSION, recordVersion: RECORD_VERSION, recoveryCount, migratedAt: nowValue(options.now)});
          return;
        }
        try {
          const migrated = migrateRecord(cursor.value, options);
          if (stableStringify(migrated) !== stableStringify(cursor.value)) {
            if (migrated.id === cursor.primaryKey) cursor.update(migrated);
            else {
              cursor.delete();
              store.add(migrated);
            }
          }
        } catch (error) {
          // Keep an invalid/future row byte-for-byte in the original store.
          // Valid rows remain usable and listRecovery() exposes this raw value
          // for a separate manual-recovery download.
          recoveryCount += 1;
        }
        cursor.continue();
      };
      cursorRequest.onerror = () => reject(cursorRequest.error || new CollectionError('MIGRATION_FAILED', '보유함 마이그레이션에 실패했습니다.'));
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new CollectionError('MIGRATION_FAILED', '보유함 마이그레이션에 실패했습니다.'));
      transaction.onerror = () => { /* handled by abort */ };
    });
  }

  class CollectionRepository {
    constructor(database, options) {
      this.database = database;
      this.options = options;
      this.database.onversionchange = () => this.database.close();
    }

    close() { this.database.close(); }

    async get(id) {
      const transaction = this.database.transaction('specimens', 'readonly');
      const value = await requestPromise(transaction.objectStore('specimens').get(id));
      await transactionPromise(transaction);
      return value ? migrateRecord(value, this.options) : null;
    }

    async list(filters = {}) {
      const transaction = this.database.transaction('specimens', 'readonly');
      const storedValues = await requestPromise(transaction.objectStore('specimens').getAll());
      await transactionPromise(transaction);
      let values = [];
      for (const value of storedValues) {
        try { values.push(migrateRecord(value, this.options)); }
        catch (_error) { /* exposed separately through listRecovery() */ }
      }
      if (filters.speciesKey) values = values.filter(value => value.speciesKey === filters.speciesKey);
      if (filters.status) values = values.filter(value => value.status === filters.status);
      if (filters.maxKind) values = values.filter(value => value.max.kind === filters.maxKind);
      if (filters.favorite !== undefined) values = values.filter(value => value.favorite === filters.favorite);
      if (filters.tag) values = values.filter(value => value.tags.includes(filters.tag));
      const direction = filters.direction === 'asc' ? 1 : -1;
      const sort = filters.sort || 'updatedAt';
      values.sort((left, right) => {
        if (sort === 'speciesKey') return direction * left.speciesKey.localeCompare(right.speciesKey);
        if (sort === 'createdAt') return direction * (Date.parse(left.createdAt) - Date.parse(right.createdAt));
        return direction * (Date.parse(left.updatedAt) - Date.parse(right.updatedAt));
      });
      return values.map(deepClone);
    }

    async listRecovery() {
      const transaction = this.database.transaction('specimens', 'readonly');
      const storedValues = await requestPromise(transaction.objectStore('specimens').getAll());
      await transactionPromise(transaction);
      const entries = [];
      for (const value of storedValues) {
        try { migrateRecord(value, this.options); }
        catch (error) {
          entries.push({
            id: typeof value?.id === 'string' ? value.id : '',
            error: {code: error.code || 'VALIDATION_FAILED', message: error.message || '저장 레코드를 읽을 수 없습니다.'},
            raw: deepClone(value)
          });
        }
      }
      return entries;
    }

    async exportRecoveryJSON(metadata = {}) {
      const entries = await this.listRecovery();
      const seen = new WeakSet();
      const text = JSON.stringify({
        format: 'go-valuedex-recovery',
        formatVersion: 1,
        exportedAt: nowValue(this.options.now),
        appVersion: String(metadata.appVersion || DEFAULT_APP_VERSION),
        entries
      }, (_key, value) => {
        if (typeof value === 'bigint') return {type: 'bigint', value: String(value)};
        if (value && typeof value === 'object') {
          if (seen.has(value)) return {type: 'circular-reference'};
          seen.add(value);
        }
        return value;
      }, 2);
      return `${text}\n`;
    }

    async add(input) {
      const record = migrateRecord(input, this.options);
      const transaction = this.database.transaction('specimens', 'readwrite');
      const store = transaction.objectStore('specimens');
      try {
        const count = await requestPromise(store.count());
        const maxRecords=this.options.maxRecords??MAX_IMPORT_RECORDS;
        if (count >= maxRecords) throw new CollectionError('RECORD_LIMIT_EXCEEDED', `보유함에는 최대 ${maxRecords.toLocaleString()}마리까지 저장할 수 있습니다.`, count);
        store.add(record);
        await transactionPromise(transaction);
        return deepClone(record);
      } catch (error) {
        try { transaction.abort(); } catch (_abortError) { /* already inactive */ }
        throw error;
      }
    }

    async update(id, patch, options = {}) {
      if (options.expectedRevision === undefined) throw new CollectionError('EXPECTED_REVISION_REQUIRED', '안전한 변경을 위해 expectedRevision이 필요합니다.', id);
      const transaction = this.database.transaction('specimens', 'readwrite');
      const store = transaction.objectStore('specimens');
      try {
        const current = await requestPromise(store.get(id));
        if (!current) throw new CollectionError('RECORD_NOT_FOUND', `보유 개체를 찾을 수 없습니다: ${id}`, id);
        if (options.expectedRevision !== undefined && current.revision !== options.expectedRevision) throw new CollectionError('REVISION_CONFLICT', '다른 탭에서 이 기록을 먼저 변경했습니다.', {expected: options.expectedRevision, actual: current.revision});
        const changes = deepClone(patch || {});
        const next = {
          ...current,
          ...changes,
          id: current.id,
          createdAt: current.createdAt,
          revision: current.revision + 1,
          updatedAt: nowValue(this.options.now),
          ivs: changes.ivs === undefined ? current.ivs : changes.ivs,
          moves: changes.moves === undefined ? current.moves : changes.moves,
          max: changes.max === undefined ? current.max : changes.max
        };
        const result = validateRecord(next);
        if (!result.valid) throw new CollectionValidationError(result.errors, result.warnings);
        const canonical = canonicalRecord(next);
        store.put(canonical);
        await transactionPromise(transaction);
        return deepClone(canonical);
      } catch (error) {
        try { transaction.abort(); } catch (_abortError) { /* already inactive */ }
        throw error;
      }
    }

    async remove(id, options = {}) {
      if (options.expectedRevision === undefined) throw new CollectionError('EXPECTED_REVISION_REQUIRED', '안전한 삭제를 위해 expectedRevision이 필요합니다.', id);
      const transaction = this.database.transaction('specimens', 'readwrite');
      const store = transaction.objectStore('specimens');
      try {
        if (options.expectedRevision !== undefined) {
          const current = await requestPromise(store.get(id));
          if (!current) throw new CollectionError('RECORD_NOT_FOUND', `보유 개체를 찾을 수 없습니다: ${id}`, id);
          if (current.revision !== options.expectedRevision) throw new CollectionError('REVISION_CONFLICT', '다른 탭에서 이 기록을 먼저 변경했습니다.', {expected: options.expectedRevision, actual: current.revision});
        }
        store.delete(id);
        await transactionPromise(transaction);
      } catch (error) {
        try { transaction.abort(); } catch (_abortError) { /* already inactive */ }
        throw error;
      }
    }

    async clear() {
      const transaction = this.database.transaction('specimens', 'readwrite');
      transaction.objectStore('specimens').clear();
      await transactionPromise(transaction);
    }

    async importRecords(records, options = {}) {
      const transaction = this.database.transaction('specimens', 'readwrite');
      const store = transaction.objectStore('specimens');
      try {
        // Read, plan, and replace while holding one write transaction so a
        // concurrent tab cannot add a record between the merge read and put.
        const existing = await requestPromise(store.getAll());
        const plan = planImport(existing, records, {...this.options, ...options});
        store.clear();
        for (const record of plan.records) store.put(record);
        await transactionPromise(transaction);
        return deepClone(plan.report);
      } catch (error) {
        try { transaction.abort(); } catch (_abortError) { /* already inactive */ }
        throw error;
      }
    }

    async exportJSON(metadata = {}, options = {}) {
      return serializeJSON(await this.list({direction: 'asc'}), metadata, {maxRecords: Number.MAX_SAFE_INTEGER, ...this.options, ...options});
    }

    async exportCSV(metadata = {}, options = {}) {
      return serializeCSV(await this.list({direction: 'asc'}), metadata, {maxRecords: Number.MAX_SAFE_INTEGER, ...this.options, ...options});
    }

    async importJSON(text, options = {}) {
      const parsed = await parseJSON(text, {...this.options, ...options});
      const report = await this.importRecords(parsed.records, options);
      return {...report, warnings: parsed.warnings, metadata: parsed.metadata};
    }

    async importCSV(text, options = {}) {
      const parsed = parseCSV(text, {...this.options, ...options});
      const report = await this.importRecords(parsed.records, options);
      return {...report, warnings: parsed.warnings, metadata: parsed.metadata};
    }
  }

  async function open(options = {}) {
    const indexedDBFactory = options.indexedDB || globalThis.indexedDB;
    if (!indexedDBFactory || typeof indexedDBFactory.open !== 'function') throw new CollectionError('IDB_UNAVAILABLE', '이 브라우저에서는 IndexedDB를 사용할 수 없습니다.');
    const database = await openDatabase(indexedDBFactory, options.databaseName || DB_NAME);
    database.onversionchange = () => database.close();
    try { await migrateStoredRecords(database, options); }
    catch (error) { database.close(); throw error; }
    return new CollectionRepository(database, options);
  }

  return Object.freeze({
    DB_NAME,
    DB_VERSION,
    RECORD_VERSION,
    EXPORT_FORMAT,
    EXPORT_FORMAT_VERSION,
    MAX_IMPORT_BYTES,
    MAX_IMPORT_RECORDS,
    CSV_HEADERS,
    CollectionError,
    CollectionValidationError,
    open,
    createRecordFromState,
    recordToSnapshot,
    validateRecord,
    auditRecord,
    migrateRecord,
    planImport,
    serializeJSON,
    parseJSON,
    serializeCSV,
    parseCSV,
    stableStringify
  });
});
