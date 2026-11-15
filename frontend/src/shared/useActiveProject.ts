import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from './api';

export function useActiveProject() {
  const [params, setParams] = useSearchParams();
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.myProjects });
  const wanted = params.get('project');
  const active = projects.data?.find((p) => p.id === wanted) ?? projects.data?.[0];
  return {
    projects,
    active,
    select: (id: string) => setParams((p) => { p.set('project', id); return p; }),
  };
}
