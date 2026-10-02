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