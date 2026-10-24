// Fixed-point mass handling. Conserved inventory is stored as integer grams;
// no floating-point arithmetic is applied to declared or allocated quantities.

export type MassUnit = 'kg' | 't' | 'g';

export const SUPPORTED_UNITS: Record<string, MassUnit> = {
  kg: 'kg',
  kgs: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  t: 't',
  mt: 't',
  tonne: 't',
  tonnes: 't',
  'metric ton': 't',
  'metric tons': 't',
  g: 'g',
  gram: 'g',
  grams: 'g',
};

const GRAMS_PER_UNIT: Record<MassUnit, bigint> = { g: 1n, kg: 1000n, t: 1_000_000n };

export type ParsedQuantity =
  | {
      ok: true;
      grams: number;
      original: string;
      unit: MassUnit;
      conversion: string;
    }
  | {
      ok: false;
      original: string;
      reason:
        | 'missing'
        | 'ambiguous_separator'
        | 'not_a_number'
        | 'non_positive'
        | 'too_precise'
        | 'unknown_unit'
        | 'too_large';
      message: string;
    };

export function normalizeUnit(raw: string | undefined | null): MassUnit | null {
  if (raw == null) return null;
  const key = raw.trim().toLowerCase();
  return SUPPORTED_UNITS[key] ?? null;
}

/**
 * Parses a decimal quantity string in a declared unit into integer grams.
 * Rejects comma separators because "1,000" is 1000 in one convention and 1.0 in another.
 */
export function parseQuantity(rawValue: string | undefined | null, rawUnit: string | undefined | null): ParsedQuantity {
  const original = (rawValue ?? '').trim();
  if (original === '') {
    return { ok: false, original, reason: 'missing', message: 'Quantity is empty.' };
  }
  if (original.includes(',')) {
    return {
      ok: false,
      original,
      reason: 'ambiguous_separator',
      message: `"${original}" contains a comma, which can mean a thousands separator or a decimal mark. Re-enter it using digits and an optional "." decimal point, for example 1000 or 1000.5.`,
    };
  }
  const unit = normalizeUnit(rawUnit);
  if (!unit) {
    return {
      ok: false,
      original,
      reason: 'unknown_unit',
      message: `Unit "${(rawUnit ?? '').trim() || '(blank)'}" is not supported. Use kg, t (metric tonnes) or g.`,
    };
  }
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(original);
  if (!m) {
    return { ok: false, original, reason: 'not_a_number', message: `"${original}" is not a plain decimal number.` };
  }
  const [, sign, whole = '0', frac = ''] = m;
  const scale = GRAMS_PER_UNIT[unit];
  const scaleDigits = scale.toString().length - 1;
  const trimmedFrac = frac.replace(/0+$/, '');
  if (trimmedFrac.length > scaleDigits) {
    return {
      ok: false,
      original,
      reason: 'too_precise',
      message: `"${original} ${unit}" is more precise than 1 gram. Round it at the source and re-upload it; LotHold does not round declared quantities.`,
    };
  }
  const fracPadded = trimmedFrac.padEnd(scaleDigits, '0');
  const grams = BigInt(whole) * scale + (scaleDigits > 0 ? BigInt(fracPadded || '0') : 0n);
  if (sign === '-' || grams <= 0n) {
    return { ok: false, original, reason: 'non_positive', message: `Quantity must be greater than zero; received "${original}".` };
  }
  if (grams > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { ok: false, original, reason: 'too_large', message: `"${original} ${unit}" exceeds the supported range.` };
  }
  return {
    ok: true,
    grams: Number(grams),
    original,
    unit,
    conversion: unit === 'g' ? 'grams (no conversion)' : `1 ${unit} = ${scale.toString()} g (exact)`,
  };
}

/** Formats integer grams as kilograms with up to three decimals, without floating-point division. */
export function formatKg(grams: number): string {
  if (!Number.isSafeInteger(grams)) throw new Error('grams must be a safe integer');
  const neg = grams < 0;
  const abs = BigInt(Math.abs(grams));
  const whole = abs / 1000n;
  const frac = (abs % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${neg ? '−' : ''}${wholeStr}${frac ? '.' + frac : ''} kg`;
}

/** Plain kilogram decimal for machine outputs (XML netWeight), e.g. "1250.5". */
export function gramsToKgDecimal(grams: number): string {
  const abs = BigInt(Math.abs(grams));
  const whole = abs / 1000n;
  const frac = (abs % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return `${grams < 0 ? '-' : ''}${whole.toString()}${frac ? '.' + frac : ''}`;
}

export function sumGrams(values: number[]): number {
  let total = 0n;
  for (const v of values) total += BigInt(v);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('sum exceeds safe range');
  return Number(total);
}
