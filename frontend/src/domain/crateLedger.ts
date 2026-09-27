export type DualAssetSale = {
  productStockBefore: number;
  crateBalanceBefore: number;
  cratesSold: number;
  cratesReturned: number;
  unitPrice: number;
  onCredit: boolean;
};

export type DualAssetResult = {
  productStockAfter: number;
  crateBalanceAfter: number;
  saleAmount: number;
  creditDelta: number;
};

export function applyDualAssetSale(sale: DualAssetSale): DualAssetResult {
  if (sale.cratesSold < 0 || sale.cratesReturned < 0) {
    throw new Error("crate quantities cannot be negative");
  }
  if (sale.cratesSold > sale.productStockBefore) {
    throw new Error("insufficient stock for this sale");
  }
  const saleAmount = sale.unitPrice * sale.cratesSold;
  return {
    productStockAfter: sale.productStockBefore - sale.cratesSold,
    crateBalanceAfter: sale.crateBalanceBefore + sale.cratesSold - sale.cratesReturned,
    saleAmount,
    creditDelta: sale.onCredit ? saleAmount : 0,
  };
}
