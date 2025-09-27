"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, XCircle, Loader2, Play, Check } from "lucide-react";

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
import { MatchSuggestion, MatchStatus, ContractorSummary } from "@/types/tenders";

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
  const [contractorFilter, setContractorFilter] = useState<string>("all");
  const [confidenceFilter, setConfidenceFilter] = useState<"100" | "90+" | "80+" | "all">("100");
  const [selectedMatches, setSelectedMatches] = useState<Set<string>>(new Set());
  const [commentDialog, setCommentDialog] = useState<CommentDialogState>({
    isOpen: false,
    suggestion: null,
    action: null,
  });
  const [comment, setComment] = useState("");

  // Column width state for resizable columns
  const [columnWidths, setColumnWidths] = useState({
    checkbox: 50,
    status: 80,
    ittItem: 200,  // Reduced default width
    responseItem: 250,  // Adequate width for response items
    contractor: 120,
    confidence: 100,
    actions: 120,
  });

  const tableRef = useRef<HTMLTableElement>(null);
  const isResizing = useRef<string | null>(null);
  const startX = useRef(0);
  const startWidth = useRef(0);

  // Fetch project detail for contractors
  const { data: projectDetail } = useQuery({
    queryKey: ["project-detail", projectId],
    queryFn: () => api.getProjectDetail(projectId),
  });

  // Fetch match suggestions
  const { data: allSuggestions = [], isLoading, error } = useQuery({
    queryKey: ["match-suggestions", projectId, statusFilter, contractorFilter],
    queryFn: () => api.listMatches(projectId, {
      status: statusFilter,
      contractor: contractorFilter !== "all" ? contractorFilter : undefined
    }),
  });

  // Apply confidence filtering client-side
  const suggestions = allSuggestions.filter(suggestion => {
    switch (confidenceFilter) {
      case "100":
        return suggestion.confidence >= 1.0;
      case "90+":
        return suggestion.confidence >= 0.9;
      case "80+":
        return suggestion.confidence >= 0.8;
      case "all":
      default:
        return true;
    }
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
      setSelectedMatches(prev => {
        const updated = new Set(prev);
        updated.delete(variables.matchId);
        return updated;
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to update match");
    },
  });

  // Bulk accept mutation
  const bulkAcceptMutation = useMutation({
    mutationFn: ({ matchIds, comment }: { matchIds: string[]; comment?: string }) =>
      api.bulkAcceptMatches(projectId, { matchIds, comment }),
    onSuccess: (result) => {
      toast.success(`${result.succeeded} matches accepted successfully`);
      if (result.failed > 0) {
        toast.error(`${result.failed} matches failed to accept`);
      }
      queryClient.invalidateQueries({ queryKey: ["match-suggestions", projectId] });
      queryClient.invalidateQueries({ queryKey: ["project-detail", projectId] });
      setSelectedMatches(new Set());
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to bulk accept matches");
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
  const highConfidenceCount = suggestions.filter(s => s.confidence >= 1.0).length;

  const contractors = projectDetail?.contractors || [];

  const handleSelectMatch = (matchId: string, selected: boolean) => {
    setSelectedMatches(prev => {
      const updated = new Set(prev);
      if (selected) {
        updated.add(matchId);
      } else {
        updated.delete(matchId);
      }
      return updated;
    });
  };

  const handleSelectAll = () => {
    const selectableMatches = suggestions.filter(s => s.status === "suggested");
    if (selectedMatches.size === selectableMatches.length) {
      setSelectedMatches(new Set());
    } else {
      setSelectedMatches(new Set(selectableMatches.map(s => s.matchId)));
    }
  };

  const handleBulkAccept = () => {
    if (selectedMatches.size === 0) return;

    bulkAcceptMutation.mutate({
      matchIds: Array.from(selectedMatches),
      comment: "Bulk accepted high-confidence matches"
    });
  };

  const handleAcceptAll = () => {
    const acceptableMatches = suggestions
      .filter(s => s.status === "suggested")
      .map(s => s.matchId);

    if (acceptableMatches.length === 0) return;

    bulkAcceptMutation.mutate({
      matchIds: acceptableMatches,
      comment: "Accepted all visible matches"
    });
  };

  // Resizable column handlers
  const handleMouseDown = useCallback((e: React.MouseEvent, column: string) => {
    e.preventDefault();
    isResizing.current = column;
    startX.current = e.clientX;
    startWidth.current = columnWidths[column as keyof typeof columnWidths];

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [columnWidths]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing.current) return;

    const diff = e.clientX - startX.current;
    const newWidth = Math.max(50, startWidth.current + diff);

    setColumnWidths(prev => ({
      ...prev,
      [isResizing.current!]: newWidth,
    }));
  }, []);

  const handleMouseUp = useCallback(() => {
    isResizing.current = null;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, [handleMouseMove]);

  const ResizeHandle = ({ column }: { column: string }) => (
    <div
      className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-blue-500 hover:opacity-50 z-10"
      onMouseDown={(e) => handleMouseDown(e, column)}
    />
  );

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
          <h2 className="text-2xl font-bold">Auto-Match & Review</h2>
          <p className="text-muted-foreground">Review high-confidence matches and bulk accept obvious suggestions</p>
        </div>
        <div className="flex gap-2">
          {selectedMatches.size > 0 && (
            <Button
              onClick={handleBulkAccept}
              disabled={bulkAcceptMutation.isPending}
              className="gap-2 bg-green-600 hover:bg-green-700"
            >
              {bulkAcceptMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Accept Selected ({selectedMatches.size})
            </Button>
          )}
          {suggestions.filter(s => s.status === "suggested").length > 0 && (
            <Button
              onClick={handleAcceptAll}
              disabled={bulkAcceptMutation.isPending}
              className="gap-2 bg-green-600 hover:bg-green-700"
            >
              {bulkAcceptMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Accept All
            </Button>
          )}
          <Button
            onClick={() => autoMatchMutation.mutate()}
            disabled={autoMatchMutation.isPending}
            className="gap-2"
            variant="outline"
          >
            {autoMatchMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Run Auto-Match
          </Button>
        </div>
      </div>

      {/* Statistics */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Total Matches</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{suggestions.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-purple-600">Perfect Matches</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">{highConfidenceCount}</div>
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
          <div className="flex gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Label htmlFor="confidence-filter">Confidence:</Label>
              <Select
                value={confidenceFilter}
                onValueChange={(value: "100" | "90+" | "80+" | "all") => setConfidenceFilter(value)}
              >
                <SelectTrigger id="confidence-filter" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="100">100% Only</SelectItem>
                  <SelectItem value="90+">90%+</SelectItem>
                  <SelectItem value="80+">80%+</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="contractor-filter">Contractor:</Label>
              <Select
                value={contractorFilter}
                onValueChange={(value: string) => setContractorFilter(value)}
              >
                <SelectTrigger id="contractor-filter" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Contractors</SelectItem>
                  {contractors.map(contractor => (
                    <SelectItem key={contractor.contractorId} value={contractor.contractorId}>
                      {contractor.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="status-filter">Status:</Label>
              <Select
                value={statusFilter}
                onValueChange={(value: MatchStatus | "all") => setStatusFilter(value)}
              >
                <SelectTrigger id="status-filter" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="suggested">Suggested</SelectItem>
                  <SelectItem value="accepted">Accepted</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="all">All</SelectItem>
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
              {confidenceFilter === "100" && suggestions.length === 0 && allSuggestions.length > 0
                ? "No 100% confidence matches found. Try lowering the confidence filter to see more suggestions."
                : statusFilter === "all"
                ? "No match suggestions found. Try running auto-match to generate suggestions."
                : `No ${statusFilter} suggestions found.`
              }
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table ref={tableRef} style={{ tableLayout: 'fixed', width: '100%' }}>
                <TableHeader>
                  <TableRow>
                    {statusFilter === "suggested" && (
                      <TableHead style={{ width: columnWidths.checkbox, position: 'relative' }}>
                        <input
                          type="checkbox"
                          className="rounded"
                          checked={selectedMatches.size > 0 && selectedMatches.size === suggestions.filter(s => s.status === "suggested").length}
                          onChange={handleSelectAll}
                        />
                        <ResizeHandle column="checkbox" />
                      </TableHead>
                    )}
                    <TableHead style={{ width: columnWidths.status, position: 'relative' }}>
                      Status
                      <ResizeHandle column="status" />
                    </TableHead>
                    <TableHead style={{ width: columnWidths.ittItem, position: 'relative' }}>
                      ITT Item
                      <ResizeHandle column="ittItem" />
                    </TableHead>
                    <TableHead style={{ width: columnWidths.responseItem, position: 'relative' }}>
                      Response Item
                      <ResizeHandle column="responseItem" />
                    </TableHead>
                    <TableHead style={{ width: columnWidths.contractor, position: 'relative' }}>
                      Contractor
                      <ResizeHandle column="contractor" />
                    </TableHead>
                    <TableHead style={{ width: columnWidths.confidence, position: 'relative' }}>
                      Confidence
                      <ResizeHandle column="confidence" />
                    </TableHead>
                    <TableHead style={{ width: columnWidths.actions, position: 'relative' }}>
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
              <TableBody>
                {suggestions.map((suggestion) => (
                  <TableRow key={suggestion.matchId} className={selectedMatches.has(suggestion.matchId) ? "bg-blue-50" : ""}>
                    {statusFilter === "suggested" && (
                      <TableCell style={{ width: columnWidths.checkbox, overflow: 'hidden' }}>
                        <input
                          type="checkbox"
                          className="rounded"
                          checked={selectedMatches.has(suggestion.matchId)}
                          onChange={(e) => handleSelectMatch(suggestion.matchId, e.target.checked)}
                          disabled={suggestion.status !== "suggested"}
                        />
                      </TableCell>
                    )}
                    <TableCell style={{ width: columnWidths.status, overflow: 'hidden' }}>
                      {getStatusBadge(suggestion.status)}
                    </TableCell>
                    <TableCell style={{ width: columnWidths.ittItem, overflow: 'hidden' }}>
                      <div className="space-y-1">
                        <div className="font-medium text-sm leading-tight truncate" title={suggestion.ittDescription}>
                          {suggestion.ittDescription}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          ID: {suggestion.ittItemId}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell style={{ width: columnWidths.responseItem, overflow: 'hidden' }}>
                      <div className="space-y-1">
                        <div className="font-medium text-sm leading-tight truncate"
                             title={suggestion.responseDescription || "No response description"}>
                          {suggestion.responseDescription || <span className="text-red-500 italic">No response description</span>}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {suggestion.responseItemCode ? (
                            <span>Code: {suggestion.responseItemCode}</span>
                          ) : (
                            <span className="text-gray-400 italic">No code</span>
                          )}
                          {suggestion.responseAmount && (
                            <span className="ml-2">Amount: ${suggestion.responseAmount.toLocaleString()}</span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell style={{ width: columnWidths.contractor, overflow: 'hidden' }}>
                      <div className="font-medium text-sm truncate" title={suggestion.contractorName}>
                        {suggestion.contractorName}
                      </div>
                    </TableCell>
                    <TableCell style={{ width: columnWidths.confidence, overflow: 'hidden' }}>
                      <div className="flex flex-col items-center gap-1">
                        <div className="flex items-center gap-1">
                          <div
                            className={`w-2 h-2 rounded-full ${getConfidenceColor(suggestion.confidence)}`}
                          />
                          <span className="text-sm font-bold">
                            {Math.round(suggestion.confidence * 100)}%
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {getConfidenceLabel(suggestion.confidence)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell style={{ width: columnWidths.actions, overflow: 'hidden' }}>
                      {suggestion.status === "suggested" ? (
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            className="h-7 w-7 p-0 bg-green-600 hover:bg-green-700"
                            onClick={() => handleQuickAction(suggestion, "accept")}
                            disabled={updateMatchMutation.isPending}
                          >
                            <CheckCircle className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-7 w-7 p-0"
                            onClick={() => handleQuickAction(suggestion, "reject")}
                            disabled={updateMatchMutation.isPending}
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground font-medium">
                          {suggestion.status === "accepted" ? "✅ Accepted" :
                           suggestion.status === "rejected" ? "❌ Rejected" : "Manual"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
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