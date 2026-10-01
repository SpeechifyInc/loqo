import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Skeleton } from './ui/skeleton';

/** An `undefined` value is still loading. */
export const Stat = ({ label, value }: { label: string; value: number | string | undefined }) => (
  <Card>
    <CardHeader className="pb-1">
      <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</CardTitle>
    </CardHeader>
    <CardContent className="text-2xl font-semibold tabular-nums">{value === undefined ? <Skeleton className="h-8 w-20" /> : value}</CardContent>
  </Card>
);
