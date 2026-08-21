/**
 * Normalizes Turkish and extended characters to standard Latin characters.
 * Spec mappings:
 *   İ (\u0130) -> I
 *   ı (\u0131) -> i
 *   Ü (\u00DC) -> U
 *   ü (\u00FC) -> u
 *   Ö (\u00D6) -> O
 *   ö (\u00F6) -> o
 *   Ş (\u015E) -> S
 *   ş (\u015F) -> s
 *   Ğ (\u011E) -> G
 *   ğ (\u011F) -> g
 *   Ç (\u00C7) -> C
 *   ç (\u00E7) -> c
 */
export function normalizeTurkish(input: string): string;
export function normalizeTurkish(input: null | undefined): null | undefined;
export function normalizeTurkish(input: any): any;
export function normalizeTurkish(input: any): any {
  if (typeof input !== 'string') return input;
  if (!input) return input;

  return input
    .replace(/\u0130/g, 'I') // İ -> I
    .replace(/\u0131/g, 'i') // ı -> i
    .replace(/\u00DC/g, 'U') // Ü -> U
    .replace(/\u00FC/g, 'u') // ü -> u
    .replace(/\u00D6/g, 'O') // Ö -> O
    .replace(/\u00F6/g, 'o') // ö -> o
    .replace(/\u015E/g, 'S') // Ş -> S
    .replace(/\u015F/g, 's') // ş -> s
    .replace(/\u011E/g, 'G') // Ğ -> G
    .replace(/\u011F/g, 'g') // ğ -> g
    .replace(/\u00C7/g, 'C') // Ç -> C
    .replace(/\u00E7/g, 'c'); // ç -> c
}

/**
 * Recursively traverses arrays/objects and normalizes all string values.
 */
export function sanitizeTurkishDeep<T = any>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    return normalizeTurkish(obj) as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeTurkishDeep(item)) as unknown as T;
  }
  if (typeof obj === 'object') {
    if (obj instanceof Date || (typeof Buffer !== 'undefined' && Buffer.isBuffer(obj))) {
      return obj;
    }
    const result: any = {};
    for (const key of Object.keys(obj as any)) {
      result[key] = sanitizeTurkishDeep((obj as any)[key]);
    }
    return result;
  }
  return obj;
}
