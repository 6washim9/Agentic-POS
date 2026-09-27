export type LandedCostInput = {
  crates: number;
  baseProcurement: number;
  customsDuty: number;
  freight: number;
  portClearance: number;
  transport: number;
};

export type LandedCostResult = {
  totalLanded: number;
  unitCostPerCrate: number;
};

export function computeLandedCost(input: LandedCostInput): LandedCostResult {
  if (input.crates <= 0) {
    throw new Error("crates must be greater than zero");
  }
  const parts = [
    input.baseProcurement,
    input.customsDuty,
    input.freight,
    input.portClearance,
    input.transport,
  ];
  if (parts.some((value) => value < 0)) {
    throw new Error("negative cost components are not allowed");
  }
  const totalLanded = parts.reduce((sum, value) => sum + value, 0);
  const unitCostPerCrate = Math.round((totalLanded / input.crates) * 100) / 100;
  return { totalLanded, unitCostPerCrate };
}
