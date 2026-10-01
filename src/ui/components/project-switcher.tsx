import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { projectSlugOf, useCurrentProject } from '../lib/current-project';
import { cn, initials } from '../lib/utils';
import { CreateProjectDialog } from './create-project';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from './ui/sidebar';

/** Project pages keep their sub-page but not their query (scenario ids, filters); Queue and Cost drop `?project` so they follow. */
const switchTarget = (pathname: string, slug: string): string => {
  const current = projectSlugOf(pathname);
  if (current) return `/projects/${slug}${pathname.slice(`/projects/${current}`.length)}`;
  if (pathname === '/queue' || pathname === '/analytics') return pathname;
  return `/projects/${slug}`;
};

const ProjectTile = ({ name, className }: { name: string; className: string }) => (
  <div className={cn('flex aspect-square shrink-0 items-center justify-center font-medium', className)}>{initials(name)}</div>
);

export const ProjectSwitcher = () => {
  const { project, projects, remember } = useCurrentProject();
  const { isMobile } = useSidebar();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  const select = (slug: string) => {
    remember(slug);
    void navigate(switchTarget(pathname, slug));
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
              <ProjectTile name={project.name} className="size-8 rounded-lg bg-sidebar-primary text-xs text-sidebar-primary-foreground" />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{project.name}</span>
                <span className="truncate text-xs text-sidebar-foreground/70">
                  {project.sourceLocale} → {project.targetLocales.length} locales
                </span>
              </div>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg" align="start" side={isMobile ? 'bottom' : 'right'}>
            <DropdownMenuLabel className="text-xs text-muted-foreground">Projects</DropdownMenuLabel>
            {projects.map((candidate) => (
              <DropdownMenuItem key={candidate.id} onSelect={() => select(candidate.slug)} className="gap-2 p-2">
                <ProjectTile name={candidate.name} className="size-6 rounded-md border text-[10px]" />
                <span className="truncate">{candidate.name}</span>
                {candidate.id === project.id ? <Check className="ml-auto" /> : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setCreating(true)} className="gap-2 p-2">
              <div className="flex size-6 items-center justify-center rounded-md border">
                <Plus className="size-4" />
              </div>
              <span className="font-medium text-muted-foreground">New project</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <CreateProjectDialog open={creating} onOpenChange={setCreating} />
      </SidebarMenuItem>
    </SidebarMenu>
  );
};
