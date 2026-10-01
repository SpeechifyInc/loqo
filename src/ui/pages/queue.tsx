import { useQuery } from '@tanstack/react-query';
import { ErrorNote, PageHeader } from '../components/layout';
import { ProjectFilter, useProjectParam } from '../components/project-filter';
import { Stat } from '../components/stat';
import { StatusBadge } from '../components/status';
import { keyCell, localeColumn, projectColumn, Rows, Section, withoutProject } from '../components/target-table';
import type { Column } from '../components/virtual-table';
import { api } from '../lib/api';
import { formatDate, truncate } from '../lib/utils';
import type { QueueItem } from '../../core/ops/service';

const QUEUE_COLUMNS: Column<QueueItem>[] = [
  { key: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
  projectColumn,
  { key: 'key', header: 'Key', cell: keyCell },
  localeColumn,
  { key: 'source', header: 'Source', className: 'text-muted-foreground', cell: (row) => truncate(row.source, 80) },
  { key: 'since', header: 'Since', className: 'whitespace-nowrap text-muted-foreground', cell: (row) => formatDate(row.updatedAt) },
];

export const QueuePage = () => {
  const [project, setProject] = useProjectParam();
  const status = useQuery({ queryKey: ['queue', project], queryFn: () => api.queue(project), refetchInterval: 3000 });
  const jobs = status.data?.queue;
  const counts = status.data?.targets;
  const items = status.data?.items;
  const waiting = (counts?.queued ?? 0) + (counts?.translating ?? 0);

  return (
    <div className="flex h-full flex-col gap-8">
      <div>
        <PageHeader title="Queue" description="The translate queue and the targets it feeds." actions={<ProjectFilter value={project} onChange={setProject} />} />
        <ErrorNote error={status.error} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Queued" value={counts && (counts.queued ?? 0)} />
          <Stat label="Translating" value={counts && (counts.translating ?? 0)} />
          <Stat label="Pending" value={counts && (counts.pending ?? 0)} />
        </div>
        {jobs ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Jobs, all projects: {jobs.ready} ready · {jobs.deferred} deferred · {jobs.active} active · {jobs.failed} failed
          </p>
        ) : null}
      </div>

      <Section
        title="Queue"
        description={items && items.length < waiting ? `${waiting} waiting or translating, showing the first ${items.length}.` : `${waiting} waiting or translating.`}
        grow={(items?.length ?? 0) > 0}
      >
        <Rows rows={items} columns={withoutProject(QUEUE_COLUMNS, project)} empty="Queue is empty." />
      </Section>
    </div>
  );
};
