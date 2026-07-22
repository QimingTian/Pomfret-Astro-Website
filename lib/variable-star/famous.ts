/**
 * Curated "famous" variable stars for Pomfret Remote filters.
 *
 * VSX / AAVSO do not publish a "famous" flag. We maintain an explicit seed list:
 * textbook targets, legacy AAVSO names, and well-known observatory classics.
 * Weekly shortlist build tags matching stars with category `famous` when they
 * are already in the catalog (same 14-night >=30° gate as every other star).
 *
 * To add a star: append its VSX primary name here (normalized matching accepts
 * optional `V*` prefix and case differences).
 */

const FAMOUS_VARIABLE_STAR_NAMES: readonly string[] = [
  // Cataclysmic / dwarf nova
  'SS Cyg',
  'U Gem',
  'Z Cam',
  'SU UMa',
  'WY UMa',
  // W UMa contact binaries
  'AW UMa',
  'XY UMa',
  'W UMa',
  // Algol / eclipsing
  'Algol',
  'bet Per',
  // Cepheids / RR Lyrae
  'delta Cep',
  'eta Aql',
  'RR Lyr',
  'TW Cyg',
  // Mira / long-period
  'omi Cet',
  'Mira',
  'R Leo',
  'T UMi',
  'chi Cyg',
  'R Hya',
  'R Cas',
  // Semiregular / red variables
  'R CrB',
  'T CrB',
  'RW Tau',
  'mu Cep',
  // Other classics
  'DX And',
  'RU Peg',
  'W Vir',
  'T Cyg',
  'VY UMa',
  'bet Lyr',
  'T Tau',
  'FU Ori',
  'WW Vul',
  'BF Cyg',
  'WZ Sge',
]

const FAMOUS_SET = new Set(FAMOUS_VARIABLE_STAR_NAMES.map((n) => normalizeVariableStarName(n)))

/** Normalize for comparison with VSX / catalog names. */
export function normalizeVariableStarName(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/^V\*\s+/, '')
    .replace(/\s+/g, ' ')
}

export function isFamousVariableStar(name: string): boolean {
  return FAMOUS_SET.has(normalizeVariableStarName(name))
}

/** All seed names (for tests / docs). */
export function famousVariableStarSeedNames(): readonly string[] {
  return FAMOUS_VARIABLE_STAR_NAMES
}

export function famousNameScoreBonus(name: string): number {
  return isFamousVariableStar(name) ? 10 : 0
}
