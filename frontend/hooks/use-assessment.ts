"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { AssessmentPayload, ListReportsResponse, ListInsightsResponse } from "@/types/tenders";

export function useAssessment(projectId: string) {
  return useQuery<AssessmentPayload>({
    queryKey: ["project-assessment", projectId],
    queryFn: () => api.getAssessment(projectId),
    enabled: Boolean(projectId),
    refetchInterval: 15000,
  });
}

export function useGenerateReport(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.generateReport(projectId),
    onSuccess: () => {
      // Invalidate reports list to refetch with new report
      queryClient.invalidateQueries({ queryKey: ["project-reports", projectId] });
    },
  });
}

export function useReports(projectId: string, enabled = true) {
  return useQuery<ListReportsResponse>({
    queryKey: ["project-reports", projectId],
    queryFn: () => api.listReports(projectId),
    enabled: Boolean(projectId) && enabled,
    refetchInterval: 5000, // Poll every 5 seconds to check report status
  });
}

export function useGenerateInsights(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.generateAssessmentInsights(projectId),
    onSuccess: () => {
      // Invalidate insights list to refetch with new insights
      queryClient.invalidateQueries({ queryKey: ["project-insights", projectId] });
    },
  });
}

export function useInsights(projectId: string, enabled = true) {
  return useQuery<ListInsightsResponse>({
    queryKey: ["project-insights", projectId],
    queryFn: () => api.listInsights(projectId),
    enabled: Boolean(projectId) && enabled,
    refetchInterval: 5000, // Poll every 5 seconds to check insights status
  });
}
