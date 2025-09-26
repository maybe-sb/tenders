"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { TenderProject } from "@/types/tenders";

const PROJECTS_QUERY_KEY = ["projects"] as const;

export function useProjects() {
  return useQuery({
    queryKey: PROJECTS_QUERY_KEY,
    queryFn: api.listProjects,
  });
}

export function useProject(projectId: string) {
  return useQuery({
    queryKey: [...PROJECTS_QUERY_KEY, projectId],
    queryFn: () => api.getProject(projectId),
    enabled: Boolean(projectId),
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.createProject,
    onSuccess: (project: TenderProject) => {
      queryClient.setQueryData<TenderProject[]>(PROJECTS_QUERY_KEY, (existing) =>
        existing ? [project, ...existing] : [project]
      );
    },
  });
}

export function useUpdateProject(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: Parameters<typeof api.updateProject>[1]) =>
      api.updateProject(projectId, payload),
    onSuccess: (project) => {
      queryClient.setQueryData([...PROJECTS_QUERY_KEY, projectId], project);
      queryClient.setQueryData<TenderProject[]>(PROJECTS_QUERY_KEY, (existing) =>
        existing?.map((item) => (item.projectId === projectId ? project : item)) ?? []
      );
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.deleteProject,
    onSuccess: (_, projectId) => {
      queryClient.setQueryData<TenderProject[]>(PROJECTS_QUERY_KEY, (existing) =>
        existing?.filter((project) => project.projectId !== projectId) ?? []
      );
    },
  });
}
