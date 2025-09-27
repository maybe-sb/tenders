"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, XCircle, Loader2, Play } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { MatchSuggestion, MatchStatus } from "@/types/tenders";

interface MatchSuggestionsScreenProps {
  projectId: string;
}

interface CommentDialogState {
  isOpen: boolean;
  suggestion: MatchSuggestion | null;
  action: "accept" | "reject" | null;
}

export function MatchSuggestionsScreen({ projectId }: MatchSuggestionsScreenProps) {
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<MatchStatus | "all">("suggested");
  const [commentDialog, setCommentDialog] = useState<CommentDialogState>({
    isOpen: false,
    suggestion: null,
    action: null,
  });
  const [comment, setComment] = useState("");

  // Fetch match suggestions
  const { data: suggestions = [], isLoading, error } = useQuery({
    queryKey: ["match-suggestions", projectId, statusFilter],
    queryFn: () => api.listMatches(projectId, { status: statusFilter }),
  });

  // Trigger auto-match mutation
  const autoMatchMutation = useMutation({
    mutationFn: () => api.triggerAutoMatch(projectId),
    onSuccess: () => {
      toast.success("Auto-match started. The system is generating match suggestions.");
      // Refresh suggestions after a delay
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["match-suggestions", projectId] });
      }, 3000);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to start auto-matching");
    },
  });

  // Update match status mutation
  const updateMatchMutation = useMutation({
    mutationFn: ({ matchId, status, comment }: { matchId: string; status: MatchStatus; comment?: string }) =>
      api.updateMatchStatus(projectId, { matchId, status, comment }),
    onSuccess: (_, variables) => {
      toast.success(variables.status === "accepted" ? "Match accepted" : "Match rejected");
      queryClient.invalidateQueries({ queryKey: ["match-suggestions", projectId] });
      queryClient.invalidateQueries({ queryKey: ["project-detail", projectId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to update match");
    },
  });

  const handleQuickAction = (suggestion: MatchSuggestion, action: "accept" | "reject") => {
    if (suggestion.confidence < 0.8 || action === "reject") {
      // Show comment dialog for low confidence matches or rejections
      setCommentDialog({
        isOpen: true,
        suggestion,
        action,
      });
      setComment("");
    } else {
      // Direct action for high confidence accepts
      updateMatchMutation.mutate({
        matchId: suggestion.matchId,
        status: action === "accept" ? "accepted" : "rejected",
      });
    }
  };

  const handleCommentSubmit = () => {
    if (!commentDialog.suggestion || !commentDialog.action) return;

    updateMatchMutation.mutate({
      matchId: commentDialog.suggestion.matchId,
      status: commentDialog.action === "accept" ? "accepted" : "rejected",
      comment: comment.trim() || undefined,
    });

    setCommentDialog({ isOpen: false, suggestion: null, action: null });
    setComment("");
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.9) return "bg-green-500";
    if (confidence >= 0.75) return "bg-blue-500";
    if (confidence >= 0.6) return "bg-yellow-500";
    return "bg-red-500";
  };

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 0.9) return "Very High";
    if (confidence >= 0.75) return "High";
    if (confidence >= 0.6) return "Medium";
    return "Low";
  };

  const getStatusBadge = (status: MatchStatus) => {
    switch (status) {
      case "suggested":
        return <Badge variant="outline">Suggested</Badge>;
      case "accepted":
        return <Badge variant="default" className="bg-green-600">Accepted</Badge>;
      case "rejected":
        return <Badge variant="destructive">Rejected</Badge>;
      case "manual":
        return <Badge variant="secondary">Manual</Badge>;
    }
  };

  const suggestedCount = suggestions.filter(s => s.status === "suggested").length;
  const acceptedCount = suggestions.filter(s => s.status === "accepted").length;
  const rejectedCount = suggestions.filter(s => s.status === "rejected").length;

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center text-red-600">
            Failed to load match suggestions: {error instanceof Error ? error.message : "Unknown error"}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with stats and actions */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Match Suggestions</h2>
          <p className="text-muted-foreground">Review and approve suggested matches between ITT and response items</p>
        </div>
        <Button
          onClick={() => autoMatchMutation.mutate()}
          disabled={autoMatchMutation.isPending}
          className="gap-2"
        >
          {autoMatchMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Run Auto-Match
        </Button>
      </div>

      {/* Statistics */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Total Suggestions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{suggestions.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-blue-600">Pending Review</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{suggestedCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-green-600">Accepted</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{acceptedCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-red-600">Rejected</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{rejectedCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            <div className="flex items-center gap-2">
              <Label htmlFor="status-filter">Status:</Label>
              <Select
                value={statusFilter}
                onValueChange={(value: MatchStatus | "all") => setStatusFilter(value)}
              >
                <SelectTrigger id="status-filter" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="suggested">Suggested</SelectItem>
                  <SelectItem value="accepted">Accepted</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Suggestions table */}
      <Card>
        <CardHeader>
          <CardTitle>Match Suggestions</CardTitle>
          <CardDescription>
            {statusFilter === "all"
              ? `Showing all ${suggestions.length} match suggestions`
              : `Showing ${suggestions.length} ${statusFilter} match suggestions`
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="ml-2">Loading suggestions...</span>
            </div>
          ) : suggestions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {statusFilter === "all"
                ? "No match suggestions found. Try running auto-match to generate suggestions."
                : `No ${statusFilter} suggestions found.`
              }
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Status</TableHead>
                  <TableHead>ITT Item</TableHead>
                  <TableHead>Response Item</TableHead>
                  <TableHead>Contractor</TableHead>
                  <TableHead className="w-20">Confidence</TableHead>
                  <TableHead className="w-32">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suggestions.map((suggestion) => (
                  <TableRow key={suggestion.matchId}>
                    <TableCell>
                      {getStatusBadge(suggestion.status)}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="font-medium">{suggestion.ittDescription}</div>
                        <div className="text-sm text-muted-foreground">
                          {suggestion.ittItemId}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="font-medium">{suggestion.responseDescription}</div>
                        <div className="text-sm text-muted-foreground">
                          {suggestion.responseItemCode && (
                            <span>Code: {suggestion.responseItemCode}</span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{suggestion.contractorName}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-2 h-2 rounded-full ${getConfidenceColor(suggestion.confidence)}`}
                        />
                        <span className="text-sm font-medium">
                          {Math.round(suggestion.confidence * 100)}%
                        </span>
                        <span className="text-xs text-muted-foreground">
                          ({getConfidenceLabel(suggestion.confidence)})
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {suggestion.status === "suggested" ? (
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="default"
                            className="h-8 w-8 p-0"
                            onClick={() => handleQuickAction(suggestion, "accept")}
                            disabled={updateMatchMutation.isPending}
                          >
                            <CheckCircle className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-8 w-8 p-0"
                            onClick={() => handleQuickAction(suggestion, "reject")}
                            disabled={updateMatchMutation.isPending}
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          {suggestion.status === "accepted" ? "Approved" :
                           suggestion.status === "rejected" ? "Declined" : "Manual"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Comment Dialog */}
      <Dialog open={commentDialog.isOpen} onOpenChange={(open) => {
        if (!open) {
          setCommentDialog({ isOpen: false, suggestion: null, action: null });
          setComment("");
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {commentDialog.action === "accept" ? "Accept Match" : "Reject Match"}
            </DialogTitle>
            <DialogDescription>
              {commentDialog.action === "accept"
                ? "You're about to accept this match suggestion. Add a comment if needed."
                : "You're about to reject this match suggestion. Please provide a reason."
              }
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="comment">Comment {commentDialog.action === "reject" && "(Required)"}</Label>
              <Textarea
                id="comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={
                  commentDialog.action === "accept"
                    ? "Optional comment about why you're accepting this match..."
                    : "Please explain why you're rejecting this match..."
                }
                className="mt-2"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setCommentDialog({ isOpen: false, suggestion: null, action: null })}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCommentSubmit}
                disabled={updateMatchMutation.isPending || (commentDialog.action === "reject" && !comment.trim())}
                variant={commentDialog.action === "accept" ? "default" : "destructive"}
              >
                {updateMatchMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {commentDialog.action === "accept" ? "Accept Match" : "Reject Match"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}