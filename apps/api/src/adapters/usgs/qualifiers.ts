import type { Qualifier } from '@rowing/core';

// USGS publishes no list of these codes; meanings are inferred from their names. Decided in #13.
// See docs/DATA_SOURCES.md (Qualifiers).
const specificCodes: Record<string, Qualifier> = {
  ICE: 'iceAffected',
  EQUIP: 'equipmentMalfunction',
  ESTIMATED: 'estimated',
};

// The value may be wrong. LESSTHAN and BLWMIN mean the true value is lower than shown, which
// could pass a minimum limit the true value fails.
export const unreliableCodes: ReadonlySet<string> = new Set([
  'MAINT',
  'FLOOD',
  'BACKWATER',
  'RATINGDEV',
  'DEBRIS',
  'DAMFAILURE',
  'TEST',
  'LESSTHAN',
  'BLWMIN',
]);

// Codes that say nothing about this value's reliability. Discontinued, seasonal, and
// unavailable gauges are caught as stale or missing instead.
export const informationalCodes: ReadonlySet<string> = new Set([
  'DISCONTINUED',
  'SEASONAL',
  'UNAVAIL',
  'DRY',
  'ZEROFLOW',
  'REVISED',
  'URBAN',
  'REGULATED',
  'TIDE',
  'DIFFDATUM',
  'OTHERAGENCY',
  'OPPORTUNISTIC',
  'FORCEINTERPOLATION',
]);

export interface MappedQualifiers {
  qualifiers: Qualifier[];
  // Codes this mapping doesn't know, already counted as unreliable. The caller logs them.
  unrecognized: string[];
}

export function mapUsgsQualifiers(
  approvalStatus: string | null,
  codes: readonly string[] | null,
): MappedQualifiers {
  const qualifiers = new Set<Qualifier>();
  const unrecognized: string[] = [];

  if (approvalStatus === 'Provisional') qualifiers.add('provisional');
  else if (approvalStatus !== 'Approved' && approvalStatus !== null) {
    qualifiers.add('unreliable');
    unrecognized.push(`approval_status:${approvalStatus}`);
  }

  for (const code of codes ?? []) {
    const specific = specificCodes[code];
    if (specific) qualifiers.add(specific);
    else if (unreliableCodes.has(code)) qualifiers.add('unreliable');
    else if (!informationalCodes.has(code)) {
      qualifiers.add('unreliable');
      if (!unrecognized.includes(code)) unrecognized.push(code);
    }
  }

  return { qualifiers: [...qualifiers], unrecognized };
}
