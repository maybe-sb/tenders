"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { MatchFilterOption, MatchSuggestion } from "@/types/tenders";

export function useProjectMatches(
  projectId: string,
  status: MatchFilterOption = "suggested",
  contractorId?: string
) {
  return useQuery({
    queryKey: ["project-matches", projectId, status, contractorId ?? "none"],
    queryFn: () => api.listMatches(projectId, { status, contractor: contractorId }),
    enabled: Boolean(projectId && contractorId),
    refetchInterval: status === "suggested" ? 5000 : false,
  });
}

export function useMatchActions(projectId: string) {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["project-matches", projectId] });
    queryClient.invalidateQueries({ queryKey: ["project-itt-items", projectId] });
    queryClient.invalidateQueries({ queryKey: ["project-response-items", projectId] });
    queryClient.invalidateQueries({ queryKey: ["project-detail", projectId] });
    queryClient.invalidateQueries({ queryKey: ["project-unmatched-summary", projectId] });
  };

  const acceptMatch = useMutation({
    mutationFn: (matchId: string) =>
      api.updateMatchStatus(projectId, { matchId, status: "accepted" }),
    onSuccess: invalidate,
  });

  const rejectMatch = useMutation({
    mutationFn: (matchId: string) =>
      api.updateMatchStatus(projectId, { matchId, status: "rejected" }),
    onSuccess: invalidate,
  });

  const createManualMatch = useMutation({
    mutationFn: (payload: { ittItemId: string; responseItemId: string }) =>
      api.createManualMatch(projectId, payload),
    onSuccess: invalidate,
  });

  const triggerAutoMatch = useMutation({
    mutationFn: (payload?: { contractorId?: string }) => api.triggerAutoMatch(projectId, payload),
    onSuccess: invalidate,
  });

  return {
    acceptMatch,
    rejectMatch,
    createManualMatch,
    triggerAutoMatch,
  };
}

export type ProjectMatchesResult = MatchSuggestion[];
