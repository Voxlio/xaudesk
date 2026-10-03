/**
 * HFM Cent XAUUSD contract assumptions — NOT YET VERIFIED.
 *
 * Every number below is an assumption about the broker's symbol specification,
 * not a confirmed value, and the whole displayed risk calculation rests on them.
 * They are named and exported rather than inlined so there is exactly one place
 * to correct once the spec is checked.
 *
 * Confirm each against the XAUUSD symbol specification in the live HFM Cent
 * account before trading real money:
 *
 *   STANDARD_LOT_OUNCES   100 oz per standard lot
 *   CENT_LOT_DIVISOR      100, which makes 1 cent lot = 1 ounce
 *   DEFAULT_CENT_LOT_STEP 0.01
 *   DEFAULT_MIN_CENT_LOT  0.01
 *   (no maximum lot)      unenforced — see review finding M6
 *   price decimals        2, assumed by the round(..., 2) calls in strategy/
 *
 * Leverage, margin requirement and whether HFM charges commission on gold are
 * all still unknown and are not modelled anywhere.
 *
 * OUNCES_PER_CENT_LOT === 1 is the load-bearing one: it is why the P&L in
 * lib/tradeOutcomes.ts comes out right. Import it rather than assuming the 1:1,
 * so changing CENT_LOT_DIVISOR cannot silently corrupt stored P&L.
 */
export const STANDARD_LOT_OUNCES = 100;
export const CENT_LOT_DIVISOR = 100;
export const OUNCES_PER_CENT_LOT = STANDARD_LOT_OUNCES / CENT_LOT_DIVISOR;
export const DEFAULT_CENT_LOT_STEP = 0.01;
export const DEFAULT_MIN_CENT_LOT = 0.01;

export interface CentLotOptions {
  equityUsd: number;
  riskPercent: number;
  stopDistanceUsdPerOunce: number;
  lotStep?: number;
  minimumLot?: number;
}

export interface CentLotBreakdown {
  equityUsd: number;
  terminalBalanceCents: number;
  riskPercent: number;
  riskBudgetUsd: number;
  riskBudgetCents: number;
  stopDistanceUsdPerOunce: number;
  standardLotOunces: number;
  centLotDivisor: number;
  ouncesPerCentLot: number;
  rawCentLots: number;
  lotStep: number;
  minimumLot: number;
  centLots: number;
  positionOunces: number;
  modeledRiskUsd: number;
  modeledRiskCents: number;
  minimumLotFitsRisk: boolean;
}

export function calculateCentLots(options: CentLotOptions): CentLotBreakdown {
  const lotStep = options.lotStep ?? DEFAULT_CENT_LOT_STEP;
  const minimumLot = options.minimumLot ?? DEFAULT_MIN_CENT_LOT;
  validatePositive(options.equityUsd, 'equityUsd');
  validatePositive(options.stopDistanceUsdPerOunce, 'stopDistanceUsdPerOunce');
  validatePositive(lotStep, 'lotStep');
  validatePositive(minimumLot, 'minimumLot');

  if (!Number.isFinite(options.riskPercent) || options.riskPercent < 1 || options.riskPercent > 2) {
    throw new Error('riskPercent must be between 1 and 2');
  }

  const riskBudgetUsd = (options.equityUsd * options.riskPercent) / 100;
  const rawCentLots = riskBudgetUsd / (options.stopDistanceUsdPerOunce * OUNCES_PER_CENT_LOT);
  const steps = Math.floor((rawCentLots + Number.EPSILON) / lotStep);
  const roundedLots = Number((steps * lotStep).toFixed(decimalPlaces(lotStep)));
  const positionOunces = roundedLots * OUNCES_PER_CENT_LOT;
  const modeledRiskUsd = positionOunces * options.stopDistanceUsdPerOunce;
  const minimumLotFitsRisk = roundedLots >= minimumLot;

  return {
    equityUsd: options.equityUsd,
    terminalBalanceCents: options.equityUsd * 100,
    riskPercent: options.riskPercent,
    riskBudgetUsd,
    riskBudgetCents: riskBudgetUsd * 100,
    stopDistanceUsdPerOunce: options.stopDistanceUsdPerOunce,
    standardLotOunces: STANDARD_LOT_OUNCES,
    centLotDivisor: CENT_LOT_DIVISOR,
    ouncesPerCentLot: OUNCES_PER_CENT_LOT,
    rawCentLots,
    lotStep,
    minimumLot,
    centLots: minimumLotFitsRisk ? roundedLots : 0,
    positionOunces: minimumLotFitsRisk ? positionOunces : 0,
    modeledRiskUsd: minimumLotFitsRisk ? modeledRiskUsd : 0,
    modeledRiskCents: minimumLotFitsRisk ? modeledRiskUsd * 100 : 0,
    minimumLotFitsRisk,
  };
}

function validatePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be greater than zero`);
  }
}

function decimalPlaces(value: number): number {
  const text = String(value);
  return text.includes('.') ? text.length - text.indexOf('.') - 1 : 0;
}