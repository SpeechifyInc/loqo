import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router';
import type { ProjectWithCounts } from '../../core/projects/service';

const STORAGE_KEY = 'loqo:project';

const readStored = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

const writeStored = (slug: string): void => {
  try {
    localStorage.setItem(STORAGE_KEY, slug);
  } catch {
    // Storage can be blocked; the choice then lasts only for this page load.
  }
};

export const projectSlugOf = (pathname: string): string | undefined => /^\/projects\/([^/]+)/.exec(pathname)?.[1];

type CurrentProject = { project: ProjectWithCounts; projects: ProjectWithCounts[]; remember: (slug: string) => void };

const CurrentProjectContext = createContext<CurrentProject | null>(null);

/** The URL slug wins, then the last remembered project, then the first one; `projects` must be non-empty. */
export const CurrentProjectProvider = ({ projects, children }: { projects: ProjectWithCounts[]; children: ReactNode }) => {
  const { pathname } = useLocation();
  const [stored, setStored] = useState(readStored);
  const urlSlug = projectSlugOf(pathname);
  const remember = useCallback((slug: string) => {
    writeStored(slug);
    setStored(slug);
  }, []);

  useEffect(() => {
    if (urlSlug) remember(urlSlug);
  }, [urlSlug, remember]);

  const bySlug = (slug: string | null | undefined) => projects.find((project) => project.slug === slug);
  const project = bySlug(urlSlug) ?? bySlug(stored) ?? (projects[0] as ProjectWithCounts);
  const value = useMemo(() => ({ project, projects, remember }), [project, projects, remember]);
  return <CurrentProjectContext.Provider value={value}>{children}</CurrentProjectContext.Provider>;
};

export const useCurrentProject = (): CurrentProject => {
  const current = useContext(CurrentProjectContext);
  if (!current) throw new Error('useCurrentProject outside CurrentProjectProvider');
  return current;
};

/** Pages outside `/projects/:slug` that still belong to one project make it the current one. */
export const useRememberProject = (slug: string | undefined): void => {
  const { remember } = useCurrentProject();
  useEffect(() => {
    if (slug) remember(slug);
  }, [slug, remember]);
};
