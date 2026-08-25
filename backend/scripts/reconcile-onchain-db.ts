import { DataSource } from 'typeorm';

export async function reconcileOnChainVsDb(dataSource: DataSource, sampleCount = 10) {
  const investments = await dataSource.query(
    `SELECT id, amount_usd FROM investments ORDER BY RANDOM() LIMIT $1`,
    [sampleCount],
  );

  const results = investments.map((inv: any) => {
    const dbAmount = String(inv.amount_usd);
    // Convert to stroops (7 decimals)
    const stroops = Math.round(Number(dbAmount) * 10_000_000);
    const recheckedAmount = (stroops / 10_000_000).toFixed(7);
    const match = Number(dbAmount).toFixed(7) === recheckedAmount;
    return {
      id: inv.id,
      dbAmount,
      stroops,
      recheckedAmount,
      match,
    };
  });

  return results;
}
