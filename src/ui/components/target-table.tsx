import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cn, truncate } from '../lib/utils';
import { Empty } from './layout';
import { TableSkeleton } from './skeletons';
import { type Column, VirtualTable } from './virtual-table';

export const keyCell = (row: { resourceId: string; key: string }) => (
  <Link to={`/resources/${row.resourceId}`} className="font-mono text-xs text-primary hover:underline">
    {truncate(row.key, 60)}
  </Link>
);

export const projectColumn = { key: 'project', header: 'Project', cell: (row: { projectSlug: string }) => row.projectSlug };
export const localeColumn = { key: 'locale', header: 'Locale', cell: (row: { locale: string }) => row.locale };

/** One project already names every row. */
export const withoutProject = <Row,>(columns: Column<Row>[], project: string) => (project ? columns.filter((column) => column.key !== 'project') : columns);

export const Section = ({ title, description, grow, children }: { title: string; description?: string; grow: boolean; children: ReactNode }) => (
  <section className={cn('flex min-h-0 flex-col', grow && 'min-h-72 flex-1')}>
    <h2 className={cn('text-lg font-semibold', description ? 'mb-1' : 'mb-3')}>{title}</h2>
    {description ? <p className="mb-3 text-sm text-muted-foreground">{description}</p> : null}
    {children}
  </section>
);

export const Rows = <Row extends { id: string }>({ rows, columns, empty }: { rows: Row[] | undefined; columns: Column<Row>[]; empty: string }) => {
  if (!rows) return <TableSkeleton columns={columns.length} />;
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  return <VirtualTable rows={rows} columns={columns} rowKey={(row) => row.id} />;
};
