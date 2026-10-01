import { Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { Skeleton } from './ui/skeleton';
import { TableCell, TableRow } from './ui/table';

const range = (length: number) => Array.from({ length }, (_, index) => index);

/** Placeholder rows for a table whose header is already rendered. */
export const SkeletonRows = ({ rows = 5, columns }: { rows?: number; columns: number }) =>
  range(rows).map((row) => (
    <TableRow key={row} className="hover:bg-transparent">
      {range(columns).map((column) => (
        <TableCell key={column}>
          <Skeleton className="h-4 w-full max-w-48" />
        </TableCell>
      ))}
    </TableRow>
  ));

export const TableSkeleton = ({ rows = 8, columns = 4, className }: { rows?: number; columns?: number; className?: string }) => (
  <div className={cn('overflow-hidden rounded-xl border', className)}>
    <div className="flex gap-4 border-b px-2 py-3">
      {range(columns).map((column) => (
        <Skeleton key={column} className="h-4 flex-1" />
      ))}
    </div>
    <div className="grid gap-4 p-2 py-3">
      {range(rows).map((row) => (
        <div key={row} className="flex gap-4">
          {range(columns).map((column) => (
            <Skeleton key={column} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  </div>
);

export const StatsSkeleton = ({ count, className }: { count: number; className?: string }) => (
  <div className={cn('grid gap-3', className)}>
    {range(count).map((index) => (
      <Skeleton key={index} className="h-24 rounded-xl" />
    ))}
  </div>
);

export const PageSkeleton = () => (
  <div className="grid gap-6">
    <div className="grid gap-2">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80" />
    </div>
    <TableSkeleton />
  </div>
);

/** Stands in for the whole shell before the session and project list arrive. */
export const AppSkeleton = () => (
  <div className="flex h-svh">
    <div className="hidden w-64 shrink-0 flex-col gap-3 border-r bg-sidebar p-3 md:flex">
      <Skeleton className="h-10" />
      {range(6).map((index) => (
        <Skeleton key={index} className="h-7" />
      ))}
    </div>
    <div className="min-w-0 flex-1">
      <div className="h-12 border-b" />
      <div className="px-4 py-6 md:px-8">
        <PageSkeleton />
      </div>
    </div>
  </div>
);

/** React Flow canvases show a spinner rather than a skeleton. */
export const CanvasLoader = () => (
  <div className="flex h-full items-center justify-center text-muted-foreground">
    <Loader2 className="size-6 animate-spin" />
  </div>
);
