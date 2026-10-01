import { Stat } from '../../components/stat';
import { formatUsd } from '../../lib/utils';
import type { CostRow } from '../../../core/ops/service';

/** Every grouping partitions the same calls, so any of them sums to the total. */
export const TotalSpendStat = ({ rows }: { rows: CostRow[] | undefined }) => (
  <Stat label="Total spend" value={rows && formatUsd(rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0))} />
);
