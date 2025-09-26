"use client";

import { useMutation, useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { AssessmentPayload } from "@/types/tenders";

export function useAssessment(projectId: string) {
  return useQuery<AssessmentPayload>({
    queryKey: ["project-assessment", projectId],
    queryFn: () => api.getAssessment(projectId),
    enabled: Boolean(projectId),
    refetchInterval: 15000,
  });
}

export function useGenerateReport(projectId: string) {
  return useMutation({
    mutationFn: () => api.generateReport(projectId),
  });
}
