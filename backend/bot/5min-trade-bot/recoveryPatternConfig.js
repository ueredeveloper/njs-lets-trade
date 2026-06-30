'use strict';

const RECOVERY_PATTERN_TYPES = ['two_green', 'two_one', 'three_green', 'three_one', 'five_green'];
const RECOVERY_ZONES = ['above_ma', 'between_ma'];

const RECOVERY_PATTERN_LABELS = {
  two_green:   '2 verdes seguidos (1h)',
  two_one:     '2 verdes + 1 vermelho (1h)',
  three_green: '3 verdes seguidos (1h)',
  three_one:   '3 verdes + 1 vermelho (1h)',
  five_green:  '5 verdes seguidos (1h)',
};

const RECOVERY_ZONE_LABELS = {
  above_ma:   'Acima da MA (+X%)',
  between_ma: 'Entre MA e piso adaptativo',
};

const DEFAULT_RECOVERY_PATTERN = {
  types:    ['two_green', 'two_one'],
  zones:    ['above_ma', 'between_ma'],
  abovePct: 5,
};

function recoveryPatternTypes(raw) {
  if (!raw || typeof raw !== 'object') return [];
  if (Array.isArray(raw.types)) {
    return raw.types.filter(t => RECOVERY_PATTERN_TYPES.includes(t));
  }
  if (RECOVERY_PATTERN_TYPES.includes(raw.type)) return [raw.type];
  return [];
}

function normalizeRecoveryPattern(raw, { required = false } = {}) {
  if (!raw || typeof raw !== 'object') {
    if (required) return null;
    return { ...DEFAULT_RECOVERY_PATTERN, types: [...DEFAULT_RECOVERY_PATTERN.types], zones: [...DEFAULT_RECOVERY_PATTERN.zones] };
  }

  const types = [...new Set(recoveryPatternTypes(raw))];
  if (required && !types.length) return null;

  let zones = Array.isArray(raw.zones)
    ? raw.zones.filter(z => RECOVERY_ZONES.includes(z))
    : [];
  const abovePct = Math.max(0, Math.min(20, Number(raw.abovePct ?? DEFAULT_RECOVERY_PATTERN.abovePct) || DEFAULT_RECOVERY_PATTERN.abovePct));

  if (!types.length) {
    return {
      types:    [...DEFAULT_RECOVERY_PATTERN.types],
      zones:    zones.length ? [...new Set(zones)] : [...DEFAULT_RECOVERY_PATTERN.zones],
      abovePct,
    };
  }
  if (!zones.length) {
    zones = raw.zone && RECOVERY_ZONES.includes(raw.zone) ? [raw.zone] : [...DEFAULT_RECOVERY_PATTERN.zones];
  }

  return { types, zones: [...new Set(zones)], abovePct };
}

function isActiveRecoveryPattern(rp) {
  return normalizeRecoveryPattern(rp).types.length > 0;
}

function recoveryPatternLabel(rp) {
  const cfg = normalizeRecoveryPattern(rp);
  if (!isActiveRecoveryPattern(cfg)) return 'nenhum';
  const names = cfg.types.map(t => RECOVERY_PATTERN_LABELS[t] ?? t).join(' ou ');
  const zones = cfg.zones.map(z => RECOVERY_ZONE_LABELS[z] ?? z).join(' · ');
  return `${names}${zones ? ` (${zones})` : ''}`;
}

module.exports = {
  RECOVERY_PATTERN_TYPES,
  RECOVERY_ZONES,
  RECOVERY_PATTERN_LABELS,
  RECOVERY_ZONE_LABELS,
  DEFAULT_RECOVERY_PATTERN,
  recoveryPatternTypes,
  normalizeRecoveryPattern,
  isActiveRecoveryPattern,
  recoveryPatternLabel,
};
