import { useQuery } from '@tanstack/react-query';
import { Activity, BarChart3, Layers, LogOut, ScrollText, SearchCheck, Settings2, Vault } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { api } from '../lib/api';
import { useCan, useMe, useSignOut } from '../lib/auth';
import { CurrentProjectProvider, useCurrentProject } from '../lib/current-project';
import { initials } from '../lib/utils';
import { CREATE_PROJECT_DESCRIPTION, CreateProjectForm } from './create-project';
import { ProjectSwitcher } from './project-switcher';
import { AppSkeleton } from './skeletons';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Separator } from './ui/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from './ui/sidebar';

/** `exact` items match only their own path; `roots` are other prefixes that belong to the item. */
type NavItem = { to: string; label: string; icon: typeof Vault; exact?: boolean; roots?: string[] };

const projectNav = (slug: string, canAdmin: boolean): NavItem[] => [
  { to: `/projects/${slug}`, label: 'Vault', icon: Vault, exact: true, roots: ['/resources'] },
  { to: `/projects/${slug}/layers`, label: 'Layers', icon: Layers },
  { to: `/projects/${slug}/audit`, label: 'Audit Log', icon: ScrollText },
  ...(canAdmin ? [{ to: `/projects/${slug}/settings`, label: 'Settings', icon: Settings2 }] : []),
];

const PLATFORM_NAV: NavItem[] = [
  { to: '/queue', label: 'Queue', icon: Activity },
  { to: '/analysis', label: 'Analysis', icon: SearchCheck },
  { to: '/analytics', label: 'Cost', icon: BarChart3 },
];

const isActive = (pathname: string, item: NavItem): boolean =>
  pathname === item.to || [...(item.exact ? [] : [item.to]), ...(item.roots ?? [])].some((root) => pathname.startsWith(root));

const useNav = () => {
  const { project } = useCurrentProject();
  const canAdmin = useCan(project.slug, 'admin');
  return { project: projectNav(project.slug, canAdmin), platform: PLATFORM_NAV };
};

const NavGroup = ({ label, items }: { label: string; items: NavItem[] }) => {
  const { pathname } = useLocation();
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.label}>
              <SidebarMenuButton asChild isActive={isActive(pathname, item)} tooltip={item.label}>
                <NavLink to={item.to}>
                  <item.icon />
                  <span>{item.label}</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};

const UserFooter = () => {
  const me = useMe();
  const signOut = useSignOut();
  const { state } = useSidebar();
  if (!me.user) return null;
  return (
    <SidebarFooter>
      <div className="flex items-center gap-2 rounded-md p-1 group-data-[collapsible=icon]:justify-center">
        {me.user.avatarUrl ? (
          <img src={me.user.avatarUrl} alt="" className="size-8 shrink-0 rounded-full" referrerPolicy="no-referrer" />
        ) : (
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-medium">{initials(me.user.name)}</div>
        )}
        {state === 'expanded' ? (
          <>
            <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{me.user.name}</span>
              <span className="truncate text-xs text-sidebar-foreground/70">{me.user.email}</span>
            </div>
            <Button variant="ghost" size="icon" className="size-8 shrink-0" title="Sign out" onClick={() => void signOut()}>
              <LogOut className="size-4" />
            </Button>
          </>
        ) : null}
      </div>
    </SidebarFooter>
  );
};

const AppSidebar = () => {
  const nav = useNav();
  return (
    <Sidebar>
      <SidebarHeader>
        <ProjectSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <NavGroup label="Project" items={nav.project} />
        <NavGroup label="Platform" items={nav.platform} />
      </SidebarContent>
      <UserFooter />
      <SidebarRail />
    </Sidebar>
  );
};

const Shell = () => {
  const { pathname } = useLocation();
  const nav = useNav();
  const section = [...nav.project, ...nav.platform].find((item) => isActive(pathname, item));
  return (
    <SidebarProvider className="h-svh">
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
          <span className="text-sm font-medium">{section?.label}</span>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-6 md:px-8">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
};

/** With no project there is nothing to select, so the first one is created before anything else renders. */
const FirstProject = () => (
  <div className="flex min-h-svh items-center justify-center p-4">
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>Create your first project</CardTitle>
        <CardDescription>{CREATE_PROJECT_DESCRIPTION}</CardDescription>
      </CardHeader>
      <CardContent>
        <CreateProjectForm />
      </CardContent>
    </Card>
  </div>
);

export const Layout = () => {
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects.list });
  if (projects.isPending) return <AppSkeleton />;
  if (!projects.data) return <div className="p-6"><ErrorNote error={projects.error} /></div>;
  if (projects.data.length === 0) return <FirstProject />;
  return (
    <CurrentProjectProvider projects={projects.data}>
      <Shell />
    </CurrentProjectProvider>
  );
};

export const PageHeader = ({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) => (
  <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
    <div className="min-w-0">
      <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
      {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
    </div>
    {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
  </div>
);

export const Empty = ({ children }: { children: ReactNode }) => (
  <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">{children}</div>
);

export const ErrorNote = ({ error }: { error: unknown }) =>
  error ? <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error instanceof Error ? error.message : String(error)}</div> : null;
