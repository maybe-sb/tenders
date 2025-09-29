"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";

export function useProjectDetail(projectId: string) {
  return useQuery({
    queryKey: ["project-detail", projectId],
    queryFn: () => api.getProjectDetail(projectId),
    enabled: Boolean(projectId),
    refetchInterval: 5000,
  });
}

export function useProjectIttItems(projectId: string) {
  return useQuery({
    queryKey: ["project-itt-items", projectId],
    queryFn: () => api.listIttItems(projectId),
    enabled: Boolean(projectId),
  });
}

export function useUnmatchedResponseItems(projectId: string, contractorId?: string) {
  return useQuery({
    queryKey: ["project-response-items", projectId, "unmatched", contractorId ?? "none"],
    queryFn: () => api.listResponseItems(projectId, { unmatchedOnly: true, contractorId }),
    enabled: Boolean(projectId && contractorId),
    refetchInterval: 4000,
  });
}

export function useProjectExceptions(projectId: string, contractorId?: string) {
  return useQuery({
    queryKey: ["project-exceptions", projectId, contractorId ?? "none"],
    queryFn: () => api.listExceptions(projectId, { contractorId }),
    enabled: Boolean(projectId && contractorId),
  });
}
