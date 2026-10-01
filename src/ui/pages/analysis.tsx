import { useQuery } from '@tanstack/react-query';
import { ErrorNote, PageHeader } from '../components/layout';
import { ProjectFilter, useProjectParam } from '../components/project-filter';
import { Stat } from '../components/stat';
import { StatusBadge } from '../components/status';
import { keyCell, localeColumn, projectColumn, Rows, Section, withoutProject } from '../components/target-table';
import type { Column } from '../components/virtual-table';
import { api } from '../lib/api';
import { formatDate, truncate } from '../lib/utils';
import { type QueueStatus, SUSPICIOUS_LIMIT, type SuspiciousTarget } from '../../core/ops/service';

type Failure = QueueStatus['recentFailures'][number];

const FAILURE_COLUMNS: Column<Failure>[] = [
  { key: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
  projectColumn,
  { key: 'key', header: 'Key', cell: keyCell },
  localeColumn,
  {
    key: 'reason',
    header: 'Reason',
    className: 'text-destructive',
    cell: (row) => <span title={row.lastError ?? undefined}>{truncate(row.lastError ?? '', 120)}</span>,
  },
  { key: 'when', header: 'When', className: 'whitespace-nowrap text-muted-foreground', cell: (row) => formatDate(row.updatedAt) },
];

const SUSPICIOUS_COLUMNS: Column<SuspiciousTarget>[] = [
  projectColumn,
  { key: 'key', header: 'Key', cell: keyCell },
  localeColumn,
  { key: 'value', header: 'Value', cell: (row) => truncate(row.value ?? '', 80) },
];

export const AnalysisPage = () => {
  const [project, setProject] = useProjectParam();
  // Shares the Queue page's cache entry: target counts and recent failures come with it.
  const status = useQuery({ queryKey: ['queue', project], queryFn: () => api.queue(project), refetchInterval: 3000 });
  const suspicious = useQuery({ queryKey: ['suspicious', project], queryFn: () => api.suspicious(project), refetchInterval: 15000 });
  const counts = status.data?.targets;
  const failures = status.data?.recentFailures;
  const suspiciousCount = suspicious.data?.length;

  return (
    <div className="flex h-full flex-col gap-8">
      <div>
        <PageHeader
          title="Analysis"
          description="Translations that need a human look."
          actions={<ProjectFilter value={project} onChange={setProject} />}
        />
        <ErrorNote error={status.error ?? suspicious.error} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Rejected" value={counts && (counts.rejected ?? 0)} />
          <Stat label="Failed" value={counts && (counts.failed ?? 0)} />
          <Stat label="Suspicious" value={suspiciousCount !== undefined && suspiciousCount >= SUSPICIOUS_LIMIT ? `${SUSPICIOUS_LIMIT}+` : suspiciousCount} />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-2">
        <Section title="Rejections & failures" description="Targets a guard rejected or a model call failed." grow>
          <Rows rows={failures} columns={withoutProject(FAILURE_COLUMNS, project)} empty="Nothing rejected or failed." />
        </Section>
        <Section title="Suspicious translations" description="Translated values identical to their source." grow>
          <Rows rows={suspicious.data} columns={withoutProject(SUSPICIOUS_COLUMNS, project)} empty="None." />
        </Section>
      </div>
    </div>
  );
};
