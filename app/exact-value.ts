export interface ExactRational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

export interface ExactTerm {
  readonly coefficient: ExactRational;
  readonly radicand: bigint;
  readonly piPower: number;
}

export interface ExactValue {
  readonly terms: readonly ExactTerm[];
}

export type ExactComparison = -1 | 0 | 1 | null;

export class UnsupportedExactOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedExactOperationError";
  }
}

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const TEN = BigInt(10);

function absBigInt(value: bigint): bigint {
  return value < ZERO ? -value : value;
}

function gcd(left: bigint, right: bigint): bigint {
  let a = absBigInt(left);
  let b = absBigInt(right);

  while (b !== ZERO) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }

  return a;
}

function bigintPow(base: bigint, exponent: number): bigint {
  if (!Number.isSafeInteger(exponent) || exponent < 0) {
    throw new RangeError("BigInt exponent must be a non-negative safe integer");
  }

  let result = ONE;
  let factor = base;
  let remaining = exponent;

  while (remaining > 0) {
    if (remaining % 2 === 1) result *= factor;
    remaining = Math.floor(remaining / 2);
    if (remaining > 0) factor *= factor;
  }

  return result;
}

function rational(numerator: bigint, denominator: bigint = ONE): ExactRational {
  if (denominator === ZERO) throw new RangeError("Exact rational denominator cannot be zero");
  if (numerator === ZERO) return { numerator: ZERO, denominator: ONE };

  const sign = denominator < ZERO ? -ONE : ONE;
  const divisor = gcd(numerator, denominator);

  return {
    numerator: (numerator / divisor) * sign,
    denominator: absBigInt(denominator / divisor),
  };
}

function rationalAdd(left: ExactRational, right: ExactRational): ExactRational {
  const commonDivisor = gcd(left.denominator, right.denominator);
  const leftMultiplier = right.denominator / commonDivisor;
  const rightMultiplier = left.denominator / commonDivisor;

  return rational(
    left.numerator * leftMultiplier + right.numerator * rightMultiplier,
    left.denominator * leftMultiplier,
  );
}

function rationalMultiply(left: ExactRational, right: ExactRational): ExactRational {
  const leftCancellation = gcd(left.numerator, right.denominator);
  const rightCancellation = gcd(right.numerator, left.denominator);

  return rational(
    (left.numerator / leftCancellation) * (right.numerator / rightCancellation),
    (left.denominator / rightCancellation) * (right.denominator / leftCancellation),
  );
}

function rationalDivide(left: ExactRational, right: ExactRational): ExactRational {
  if (right.numerator === ZERO) throw new RangeError("Cannot divide by zero");
  return rationalMultiply(left, rational(right.denominator, right.numerator));
}

function rationalCompare(left: ExactRational, right: ExactRational): -1 | 0 | 1 {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator;
  return difference < ZERO ? -1 : difference > ZERO ? 1 : 0;
}

function termKey(radicand: bigint, piPower: number): string {
  return `${radicand.toString()}:${piPower}`;
}

// Inputs to this function already have square-free radicands.
function makeValue(terms: Iterable<ExactTerm>): ExactValue {
  const combined = new Map<string, ExactTerm>();

  for (const term of terms) {
    if (term.coefficient.numerator === ZERO || term.radicand === ZERO) continue;
    if (term.radicand < ZERO) throw new RangeError("Exact real values cannot contain a negative radicand");
    if (!Number.isSafeInteger(term.piPower)) throw new RangeError("piPower must be a safe integer");

    const coefficient = rational(term.coefficient.numerator, term.coefficient.denominator);
    const key = termKey(term.radicand, term.piPower);
    const previous = combined.get(key);
    const nextCoefficient = previous
      ? rationalAdd(previous.coefficient, coefficient)
      : coefficient;

    if (nextCoefficient.numerator === ZERO) {
      combined.delete(key);
    } else {
      combined.set(key, {
        coefficient: nextCoefficient,
        radicand: term.radicand,
        piPower: term.piPower,
      });
    }
  }

  const normalizedTerms = [...combined.values()].sort((left, right) => {
    if (left.piPower !== right.piPower) return right.piPower - left.piPower;
    if (left.radicand === right.radicand) return 0;
    return left.radicand < right.radicand ? -1 : 1;
  });

  return { terms: normalizedTerms };
}

function integerSquareRoot(value: bigint): bigint {
  if (value < ZERO) throw new RangeError("Square root of a negative integer is not real");
  if (value < TWO) return value;

  const bitLength = value.toString(2).length;
  let estimate = ONE << BigInt(Math.ceil(bitLength / 2));
  let next = (estimate + value / estimate) / TWO;

  while (next < estimate) {
    estimate = next;
    next = (estimate + value / estimate) / TWO;
  }

  return estimate;
}

function squareFreeDecomposition(value: bigint): { outside: bigint; radicand: bigint } {
  if (value < ZERO) throw new RangeError("Square root of a negative integer is not real");
  if (value === ZERO) return { outside: ZERO, radicand: ONE };

  const root = integerSquareRoot(value);
  if (root * root === value) return { outside: root, radicand: ONE };

  let remaining = value;
  let outside = ONE;
  let radicand = ONE;
  let divisor = TWO;

  while (divisor * divisor <= remaining) {
    let exponent = 0;
    while (remaining % divisor === ZERO) {
      remaining /= divisor;
      exponent += 1;
    }

    if (exponent >= 2) outside *= bigintPow(divisor, Math.floor(exponent / 2));
    if (exponent % 2 === 1) radicand *= divisor;
    divisor = divisor === TWO ? BigInt(3) : divisor + TWO;
  }

  if (remaining > ONE) radicand *= remaining;
  return { outside, radicand };
}

function multiplyTerms(left: ExactTerm, right: ExactTerm): ExactTerm {
  // Both radicands are square-free, so their gcd is exactly the factor leaving the root.
  const commonRadicand = gcd(left.radicand, right.radicand);
  const radicand =
    (left.radicand / commonRadicand) * (right.radicand / commonRadicand);
  const coefficient = rationalMultiply(
    rationalMultiply(left.coefficient, right.coefficient),
    rational(commonRadicand),
  );

  return {
    coefficient,
    radicand,
    piPower: left.piPower + right.piPower,
  };
}

export function exactZero(): ExactValue {
  return { terms: [] };
}

export function exactOne(): ExactValue {
  return exactFromRational(ONE);
}

export function exactPi(): ExactValue {
  return makeValue([
    { coefficient: rational(ONE), radicand: ONE, piPower: 1 },
  ]);
}

export function exactFromRational(
  numerator: bigint | number,
  denominator: bigint | number = ONE,
): ExactValue {
  const coefficient = rational(BigInt(numerator), BigInt(denominator));
  if (coefficient.numerator === ZERO) return exactZero();
  return makeValue([{ coefficient, radicand: ONE, piPower: 0 }]);
}

export function exactFromNumber(value: number | bigint): ExactValue {
  if (typeof value === "bigint") return exactFromRational(value);
  if (!Number.isFinite(value)) throw new RangeError("Exact values must be finite");
  if (Object.is(value, -0) || value === 0) return exactZero();

  const match = value
    .toString()
    .match(/^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
  if (!match) throw new RangeError(`Cannot convert ${value} to an exact decimal`);

  const sign = match[1] === "-" ? -ONE : ONE;
  const fractionDigits = match[3] ?? "";
  const exponent = Number(match[4] ?? "0");
  let numerator = BigInt(`${match[2]}${fractionDigits}`) * sign;
  const scale = fractionDigits.length - exponent;

  if (scale <= 0) {
    numerator *= bigintPow(TEN, -scale);
    return exactFromRational(numerator);
  }

  return exactFromRational(numerator, bigintPow(TEN, scale));
}

export function exactAdd(left: ExactValue, right: ExactValue): ExactValue {
  return makeValue([...left.terms, ...right.terms]);
}

export function exactNegate(value: ExactValue): ExactValue {
  return makeValue(
    value.terms.map((term) => ({
      ...term,
      coefficient: rational(-term.coefficient.numerator, term.coefficient.denominator),
    })),
  );
}

export function exactSubtract(left: ExactValue, right: ExactValue): ExactValue {
  return exactAdd(left, exactNegate(right));
}

export function exactMultiply(left: ExactValue, right: ExactValue): ExactValue {
  if (left.terms.length === 0 || right.terms.length === 0) return exactZero();

  const products: ExactTerm[] = [];
  for (const leftTerm of left.terms) {
    for (const rightTerm of right.terms) products.push(multiplyTerms(leftTerm, rightTerm));
  }
  return makeValue(products);
}

export function exactDivide(dividend: ExactValue, divisor: ExactValue): ExactValue {
  if (divisor.terms.length === 0) throw new RangeError("Cannot divide by zero");
  if (divisor.terms.length === 2) {
    const rationalTerm = divisor.terms.find(
      (term) => term.radicand === ONE && term.piPower === 0,
    );
    const radicalTerm = divisor.terms.find(
      (term) => term.radicand !== ONE && term.piPower === 0,
    );
    if (rationalTerm && radicalTerm) {
      const conjugate = makeValue([
        rationalTerm,
        {
          ...radicalTerm,
          coefficient: rational(
            -radicalTerm.coefficient.numerator,
            radicalTerm.coefficient.denominator,
          ),
        },
      ]);
      const norm = exactMultiply(divisor, conjugate);
      if (
        norm.terms.length === 1 &&
        norm.terms[0].radicand === ONE &&
        norm.terms[0].piPower === 0
      ) {
        return exactDivide(exactMultiply(dividend, conjugate), norm);
      }
    }
  }
  if (divisor.terms.length !== 1) {
    throw new UnsupportedExactOperationError(
      "Exact division currently requires a monomial or quadratic-binomial divisor",
    );
  }
  if (dividend.terms.length === 0) return exactZero();

  const divisorTerm = divisor.terms[0];
  const quotients = dividend.terms.map((term): ExactTerm => {
    // sqrt(a) / sqrt(b) = gcd(a,b) * sqrt(a/gcd * b/gcd) / b.
    const commonRadicand = gcd(term.radicand, divisorTerm.radicand);
    const radicand =
      (term.radicand / commonRadicand) *
      (divisorTerm.radicand / commonRadicand);
    let coefficient = rationalDivide(term.coefficient, divisorTerm.coefficient);
    coefficient = rationalMultiply(
      coefficient,
      rational(commonRadicand, divisorTerm.radicand),
    );

    return {
      coefficient,
      radicand,
      piPower: term.piPower - divisorTerm.piPower,
    };
  });

  return makeValue(quotients);
}

export function exactPowInteger(base: ExactValue, exponent: number): ExactValue {
  if (!Number.isSafeInteger(exponent)) throw new RangeError("Exponent must be a safe integer");
  if (exponent === 0) return exactOne();
  if (exponent < 0) return exactDivide(exactOne(), exactPowInteger(base, -exponent));

  let result = exactOne();
  let factor = base;
  let remaining = exponent;

  while (remaining > 0) {
    if (remaining % 2 === 1) result = exactMultiply(result, factor);
    remaining = Math.floor(remaining / 2);
    if (remaining > 0) factor = exactMultiply(factor, factor);
  }

  return result;
}

export function exactSqrt(value: ExactValue): ExactValue {
  if (value.terms.length === 0) return exactZero();
  if (value.terms.length !== 1) {
    throw new UnsupportedExactOperationError("Exact square root currently requires one rational monomial");
  }

  const term = value.terms[0];
  if (term.coefficient.numerator < ZERO) {
    throw new RangeError("Square root of a negative exact value is not real");
  }
  if (term.radicand !== ONE || term.piPower % 2 !== 0) {
    throw new UnsupportedExactOperationError(
      "Exact square root cannot represent fourth roots or half-integer powers of pi",
    );
  }

  // sqrt(n/d) = sqrt(n*d)/d; extracting squares also rationalizes the denominator.
  const product = term.coefficient.numerator * term.coefficient.denominator;
  const decomposition = squareFreeDecomposition(product);

  return makeValue([
    {
      coefficient: rational(decomposition.outside, term.coefficient.denominator),
      radicand: decomposition.radicand,
      piPower: term.piPower / 2,
    },
  ]);
}

export function exactEqual(left: ExactValue, right: ExactValue): boolean {
  if (left.terms.length !== right.terms.length) return false;

  return left.terms.every((term, index) => {
    const other = right.terms[index];
    return (
      term.radicand === other.radicand &&
      term.piPower === other.piPower &&
      term.coefficient.numerator === other.coefficient.numerator &&
      term.coefficient.denominator === other.coefficient.denominator
    );
  });
}

function sqrtBounds(radicand: bigint, decimalDigits: number): [ExactRational, ExactRational] {
  if (radicand === ONE) {
    const one = rational(ONE);
    return [one, one];
  }

  const scale = bigintPow(TEN, decimalDigits);
  const scaledRadicand = radicand * scale * scale;
  const floor = integerSquareRoot(scaledRadicand);
  const lower = rational(floor, scale);
  const upper = floor * floor === scaledRadicand
    ? lower
    : rational(floor + ONE, scale);
  return [lower, upper];
}

function compareRadicalSumWithZero(value: ExactValue): -1 | 0 | 1 | null {
  if (value.terms.length === 0) return 0;
  if (value.terms.every((term) => term.coefficient.numerator > ZERO)) return 1;
  if (value.terms.every((term) => term.coefficient.numerator < ZERO)) return -1;
  if (value.terms.some((term) => term.piPower !== 0)) return null;

  for (const decimalDigits of [8, 16, 32, 64, 128]) {
    let lower = rational(ZERO);
    let upper = rational(ZERO);

    for (const term of value.terms) {
      const [rootLower, rootUpper] = sqrtBounds(term.radicand, decimalDigits);
      const coefficientIsPositive = term.coefficient.numerator > ZERO;
      lower = rationalAdd(
        lower,
        rationalMultiply(term.coefficient, coefficientIsPositive ? rootLower : rootUpper),
      );
      upper = rationalAdd(
        upper,
        rationalMultiply(term.coefficient, coefficientIsPositive ? rootUpper : rootLower),
      );
    }

    if (rationalCompare(lower, rational(ZERO)) > 0) return 1;
    if (rationalCompare(upper, rational(ZERO)) < 0) return -1;
  }

  return null;
}

export function exactCompare(left: ExactValue, right: ExactValue): ExactComparison {
  if (exactEqual(left, right)) return 0;
  return compareRadicalSumWithZero(exactSubtract(left, right));
}

export function exactAbs(value: ExactValue): ExactValue {
  const comparison = compareRadicalSumWithZero(value);
  if (comparison === null) {
    throw new UnsupportedExactOperationError("Could not prove the sign needed for exact absolute value");
  }
  return comparison < 0 ? exactNegate(value) : value;
}

export function exactApproximate(value: ExactValue): number {
  return value.terms.reduce((sum, term) => {
    const coefficient =
      Number(term.coefficient.numerator) / Number(term.coefficient.denominator);
    return sum + coefficient * Math.sqrt(Number(term.radicand)) * Math.PI ** term.piPower;
  }, 0);
}

function formatAbsoluteTerm(term: ExactTerm): string {
  const numerator = absBigInt(term.coefficient.numerator);
  const denominator = term.coefficient.denominator;
  const factors: string[] = [];

  if (term.radicand !== ONE) factors.push(`sqrt(${term.radicand.toString()})`);
  if (term.piPower === 1) {
    factors.push("pi");
  } else if (term.piPower !== 0) {
    factors.push(term.piPower < 0 ? `pi^(${term.piPower})` : `pi^${term.piPower}`);
  }

  if (factors.length === 0) {
    return denominator === ONE
      ? numerator.toString()
      : `${numerator.toString()}/${denominator.toString()}`;
  }

  if (numerator !== ONE) factors.unshift(numerator.toString());
  const product = factors.join("*");
  return denominator === ONE ? product : `${product}/${denominator.toString()}`;
}

export function formatExact(value: ExactValue): string {
  if (value.terms.length === 0) return "0";

  return value.terms
    .map((term, index) => {
      const body = formatAbsoluteTerm(term);
      if (index === 0) return term.coefficient.numerator < ZERO ? `-${body}` : body;
      return term.coefficient.numerator < ZERO ? ` - ${body}` : ` + ${body}`;
    })
    .join("");
}
