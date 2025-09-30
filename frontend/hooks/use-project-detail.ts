"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { ResponseItem } from "@/types/tenders";

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

export function useProjectUnassignedSummary(projectId: string) {
  return useQuery<ResponseItem[]>({
    queryKey: ["project-unmatched-summary", projectId],
    queryFn: () => api.listResponseItems(projectId, { unmatchedOnly: true }),
    enabled: Boolean(projectId),
    refetchInterval: 8000,
  });
}

export function useProjectResponseItems(projectId: string) {
  return useQuery<ResponseItem[]>({
    queryKey: ["project-response-items", projectId, "all"],
    queryFn: () => api.listResponseItems(projectId),
    enabled: Boolean(projectId),
    refetchInterval: 15000,
  });
}
