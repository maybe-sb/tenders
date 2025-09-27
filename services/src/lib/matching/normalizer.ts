/**
 * Text normalization utilities for tender item matching
 * Based on instructions.txt normalization rules
 */

// Common construction abbreviations and their expansions
const ABBREVIATIONS: Record<string, string> = {
  // Common construction terms
  'excav.': 'excavate',
  'excav': 'excavate',
  'conc': 'concrete',
  'conc.': 'concrete',
  'galv': 'galvanised',
  'galv.': 'galvanised',
  'reinf': 'reinforced',
  'reinf.': 'reinforced',
  'struct': 'structural',
  'struct.': 'structural',
  'temp': 'temporary',
  'temp.': 'temporary',
  'perm': 'permanent',
  'perm.': 'permanent',
  'maint': 'maintenance',
  'maint.': 'maintenance',
  'incl': 'including',
  'incl.': 'including',
  'excl': 'excluding',
  'excl.': 'excluding',
  'approx': 'approximately',
  'approx.': 'approximately',
  'max': 'maximum',
  'max.': 'maximum',
  'min': 'minimum',
  'min.': 'minimum',
  'avg': 'average',
  'avg.': 'average',

  // Measurements and units
  'diam': 'diameter',
  'diam.': 'diameter',
  'dia': 'diameter',
  'dia.': 'diameter',
  'thk': 'thick',
  'thk.': 'thick',
  'w/': 'with',
  'w': 'with',
  'o/': 'over',
  'u/': 'under',

  // Construction methods
  'install': 'installation',
  'instl': 'installation',
  'instl.': 'installation',
  'demo': 'demolition',
  'demo.': 'demolition',
  'fab': 'fabrication',
  'fab.': 'fabrication',
  'weld': 'welding',
  'weld.': 'welding',

  // Materials
  'alum': 'aluminium',
  'alum.': 'aluminium',
  'ss': 'stainless steel',
  'ms': 'mild steel',
  'hdpe': 'high density polyethylene',
  'pvc': 'polyvinyl chloride',
  'frp': 'fiberglass reinforced plastic',
};

// Common stopwords to remove (units, articles, prepositions)
const STOPWORDS = new Set([
  'mm', 'm', 'ea', 'each', 'item', 'items', 'no', 'nr', 'sum', 'lump',
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for',
  'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'among', 'per'
]);

export interface NormalizedText {
  original: string;
  normalized: string;
  tokens: string[];
  sortedTokens: string[];
  key: string; // tokens joined for exact matching
}

/**
 * Normalize text for matching according to instructions.txt rules:
 * - Lowercase, trim, collapse whitespace
 * - Strip punctuation except . in codes
 * - Expand common abbreviations
 * - Remove unit tokens when duplicated
 * - Standardize numeric quantities
 * - Token sort for comparison
 */
export function normalizeText(text: string, removeUnits: boolean = true): NormalizedText {
  if (!text || typeof text !== 'string') {
    const empty = { original: '', normalized: '', tokens: [], sortedTokens: [], key: '' };
    return empty;
  }

  let normalized = text.toLowerCase().trim();

  // Collapse whitespace
  normalized = normalized.replace(/\s+/g, ' ');

  // Expand abbreviations (do this before punctuation removal to preserve context)
  for (const [abbrev, expansion] of Object.entries(ABBREVIATIONS)) {
    const regex = new RegExp(`\\b${escapeRegex(abbrev)}\\b`, 'gi');
    normalized = normalized.replace(regex, expansion);
  }

  // Standardize numeric quantities (e.g., "300mm" -> "0.3 m")
  normalized = standardizeQuantities(normalized);

  // Strip punctuation except . in what look like codes (sequences with numbers and dots)
  normalized = normalized.replace(/[^\w\s.]/g, ' ');

  // Handle dots in codes vs general punctuation
  // Keep dots in sequences like "1.2.3" or "A.1.2" but remove trailing dots
  normalized = normalized.replace(/\.(?![0-9])/g, ' '); // Remove dots not followed by numbers

  // Split into tokens and filter
  let tokens = normalized.split(/\s+/).filter(token => token.length > 0);

  // Remove stopwords if requested
  if (removeUnits) {
    tokens = tokens.filter(token => !STOPWORDS.has(token));
  }

  // Remove very short tokens (single characters unless they're meaningful codes)
  tokens = tokens.filter(token =>
    token.length > 1 ||
    /^[0-9]+$/.test(token) || // Keep single digits
    /^[a-z]\.?$/.test(token) // Keep single letters (like section codes)
  );

  // Create sorted version for comparison
  const sortedTokens = [...tokens].sort();

  // Create comparison key
  const key = sortedTokens.join(' ');

  return {
    original: text,
    normalized: tokens.join(' '),
    tokens,
    sortedTokens,
    key
  };
}

/**
 * Normalize item codes for exact matching
 * Preserves dots and numbers, removes spaces and other punctuation
 */
export function normalizeItemCode(code: string): string {
  if (!code || typeof code !== 'string') {
    return '';
  }

  return code
    .toLowerCase()
    .trim()
    .replace(/[^\w.]/g, '') // Keep only word characters and dots
    .replace(/\s+/g, ''); // Remove all whitespace
}

/**
 * Calculate Jaccard similarity between two sets of tokens
 * Used for fuzzy matching
 */
export function calculateJaccardSimilarity(tokens1: string[], tokens2: string[]): number {
  if (tokens1.length === 0 && tokens2.length === 0) {
    return 1.0;
  }

  if (tokens1.length === 0 || tokens2.length === 0) {
    return 0.0;
  }

  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);

  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  return intersection.size / union.size;
}

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy matching of short strings/codes
 */
export function calculateLevenshteinDistance(str1: string, str2: string): number {
  if (str1.length === 0) return str2.length;
  if (str2.length === 0) return str1.length;

  const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

  for (let i = 0; i <= str1.length; i++) {
    matrix[0][i] = i;
  }

  for (let j = 0; j <= str2.length; j++) {
    matrix[j][0] = j;
  }

  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1, // deletion
        matrix[j - 1][i] + 1, // insertion
        matrix[j - 1][i - 1] + indicator // substitution
      );
    }
  }

  return matrix[str2.length][str1.length];
}

/**
 * Calculate normalized Levenshtein similarity (0-1 scale)
 */
export function calculateLevenshteinSimilarity(str1: string, str2: string): number {
  const maxLength = Math.max(str1.length, str2.length);
  if (maxLength === 0) return 1.0;

  const distance = calculateLevenshteinDistance(str1, str2);
  return (maxLength - distance) / maxLength;
}

/**
 * Standardize numeric quantities with units
 * Examples: "300mm" -> "0.3 m", "1.5m" -> "1.5 m"
 */
function standardizeQuantities(text: string): string {
  // Convert mm to m
  text = text.replace(/(\d+(?:\.\d+)?)\s*mm\b/g, (match, num) => {
    const meters = parseFloat(num) / 1000;
    return `${meters} m`;
  });

  // Ensure space between number and unit
  text = text.replace(/(\d+(?:\.\d+)?)([a-z]+)\b/g, '$1 $2');

  return text;
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Utility to check if two units are equivalent
 * Used as soft constraint in matching
 */
export function areUnitsEquivalent(unit1?: string, unit2?: string): boolean {
  if (!unit1 || !unit2) return false;

  const normalized1 = normalizeText(unit1, false);
  const normalized2 = normalizeText(unit2, false);

  return normalized1.key === normalized2.key;
}