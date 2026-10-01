import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { api } from '../lib/api';
import { useCurrentProject } from '../lib/current-project';
import { Select } from './ui/input';

/** `?project=` overrides the current project so a filtered view can be linked; an explicit empty value means every project. */
export const useProjectParam = (): [string, (slug: string) => void] => {
  const [params, setParams] = useSearchParams();
  const { project } = useCurrentProject();
  const setProject = (slug: string) => {
    const next = new URLSearchParams(params);
    next.set('project', slug);
    setParams(next);
  };
  return [params.get('project') ?? project.slug, setProject];
};

export const ProjectFilter = ({ value, onChange }: { value: string; onChange: (slug: string) => void }) => {
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects.list });
  return (
    <Select aria-label="Project" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All projects</option>
      {projects.data?.map((project) => (
        <option key={project.id} value={project.slug}>
          {project.name}
        </option>
      ))}
    </Select>
  );
};
