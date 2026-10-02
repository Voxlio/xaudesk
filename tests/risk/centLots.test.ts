import { calculateCentLots } from '../../risk';

describe('calculateCentLots', () => {
  it('converts $100 USD equity to terminal cents and sizes one-ounce cent lots', () => {
    const result = calculateCentLots({
      equityUsd: 100,
      riskPercent: 1,
      stopDistanceUsdPerOunce: 10,
    });

    expect(result.terminalBalanceCents).toBe(10_000);
    expect(result.riskBudgetUsd).toBe(1);
    expect(result.riskBudgetCents).toBe(100);
    expect(result.rawCentLots).toBeCloseTo(0.1, 10);
    expect(result.centLots).toBe(0.1);
    expect(result.positionOunces).toBe(0.1);
    expect(result.modeledRiskUsd).toBeCloseTo(1, 10);
  });

  it('rounds down to the broker step and never exceeds the risk budget', () => {
    const result = calculateCentLots({
      equityUsd: 200,
      riskPercent: 1,
      stopDistanceUsdPerOunce: 3,
    });

    expect(result.rawCentLots).toBeCloseTo(2 / 3, 10);
    expect(result.centLots).toBe(0.66);
    expect(result.modeledRiskUsd).toBeLessThanOrEqual(result.riskBudgetUsd);
  });

  it('returns zero lots rather than rounding up when minimum size breaches risk', () => {
    const result = calculateCentLots({
      equityUsd: 100,
      riskPercent: 1,
      stopDistanceUsdPerOunce: 1000,
    });

    expect(result.minimumLotFitsRisk).toBe(false);
    expect(result.centLots).toBe(0);
    expect(result.positionOunces).toBe(0);
  });

  it('rejects a terminal-cent balance or risk outside the supported 1-2% range', () => {
    expect(calculateCentLots({
      equityUsd: 10_000,
      riskPercent: 1,
      stopDistanceUsdPerOunce: 10,
    }).terminalBalanceCents).toBe(1_000_000);
    expect(() => calculateCentLots({
      equityUsd: 100,
      riskPercent: 3,
      stopDistanceUsdPerOunce: 10,
    })).toThrow(/between 1 and 2/);
  });
});