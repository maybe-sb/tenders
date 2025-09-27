# Accept Workflow Technical Implementation Guide

## Overview

This document provides comprehensive technical guidance for the Accept workflow in the Tenders system, covering how match acceptance works, conflict resolution, data persistence, and integration patterns.

## Business Rules

### Core Conflict Resolution Rules

1. **One Response Item → Multiple ITT Items: FORBIDDEN**
   - A single response item from a contractor cannot be used to fulfill multiple ITT requirements
   - This prevents contractors from "double-booking" the same resource/service

2. **Multiple Response Items → One ITT Item: ALLOWED**
   - Multiple contractors can bid on the same ITT requirement
   - The system supports competitive bidding scenarios

### Match Status Lifecycle

```
suggested → accepted (via Accept action)
suggested → rejected (via Reject action)
suggested → manual (via manual creation)
manual → accepted (via Accept action)
```

## Architecture Overview

### Components

1. **Frontend Components**
   - `match-suggestions-screen.tsx` - Main UI for reviewing matches
   - Bulk operations: Accept All, Accept Selected
   - Individual row actions: Accept, Reject

2. **Backend API Endpoints**
   - `POST /projects/{projectId}/match/status` - Update single match
   - `POST /projects/{projectId}/match/bulk-accept` - Bulk accept matches
   - `POST /projects/{projectId}/match/manual` - Create manual matches

3. **Data Layer**
   - DynamoDB single-table design for match storage
   - Real-time conflict detection during acceptance

## Implementation Details

### 1. Individual Match Acceptance

**API Endpoint:** `POST /projects/{projectId}/match/status`

**Request Payload:**
```typescript
{
  matchId: string;
  status: "accepted" | "rejected" | "suggested" | "manual";
  comment?: string;
  confidence?: number;
}
```

**Implementation Flow:**
```typescript
// services/src/handlers/api/match.ts:updateMatchStatus
export async function updateMatchStatus(event: ApiEvent, params: Record<string, string>) {
  // 1. Validate project access
  const project = await getProjectItem(ownerSub, projectId);

  // 2. Parse and validate payload
  const payload = UPDATE_MATCH_STATUS_SCHEMA.parse(getJsonBody(event));

  // 3. Get existing match for conflict checking
  const existingMatch = await getProjectMatch(ownerSub, projectId, payload.matchId);

  // 4. Conflict resolution validation
  if (payload.status === "accepted") {
    const allMatches = await fetchProjectMatches(ownerSub, projectId, { status: "all" });

    // Check if response item is already matched to different ITT item
    const conflicting = allMatches.find((match) =>
      match.responseItemId === existingMatch.responseItemId &&
      match.ittItemId !== existingMatch.ittItemId &&
      match.status === "accepted" &&
      match.matchId !== payload.matchId
    );

    if (conflicting) {
      return jsonResponse(409, {
        message: "Response item is already matched to a different ITT item",
        details: { conflictingMatchId, conflictingIttItemId }
      });
    }
  }

  // 5. Update match status
  const match = await updateProjectMatch(ownerSub, projectId, payload.matchId, {
    status: payload.status,
    confidence: payload.confidence,
    comment: payload.comment,
  });

  // 6. Return enriched match data
  return jsonResponse(200, enrichedMatchData);
}
```

### 2. Bulk Match Acceptance

**API Endpoint:** `POST /projects/{projectId}/match/bulk-accept`

**Request Payload:**
```typescript
{
  matchIds: string[];  // Max 100 matches per request
  comment?: string;
}
```

**Implementation Flow:**
```typescript
// services/src/handlers/api/match.ts:bulkAcceptMatches
export async function bulkAcceptMatches(event: ApiEvent, params: Record<string, string>) {
  // 1. Validate project and parse payload
  const payload = BULK_ACCEPT_SCHEMA.parse(getJsonBody(event));

  // 2. Pre-validate ALL matches for conflicts before accepting ANY
  const allMatches = await fetchProjectMatches(ownerSub, projectId, { status: "all" });
  const matchesToAccept = allMatches.filter(match => payload.matchIds.includes(match.matchId));

  const conflicts = [];
  for (const match of matchesToAccept) {
    const conflicting = allMatches.find((existingMatch) =>
      existingMatch.responseItemId === match.responseItemId &&
      existingMatch.ittItemId !== match.ittItemId &&
      existingMatch.status === "accepted" &&
      existingMatch.matchId !== match.matchId
    );

    if (conflicting) {
      conflicts.push({
        matchId: match.matchId,
        error: "Response item is already matched to a different ITT item",
        conflictDetails: { conflictingMatchId, conflictingIttItemId, responseItemId }
      });
    }
  }

  // 3. Return conflicts without processing if any exist
  if (conflicts.length > 0) {
    return jsonResponse(409, {
      message: "Bulk accept failed due to conflicts",
      conflicts,
      conflictCount: conflicts.length,
      totalRequested: payload.matchIds.length
    });
  }

  // 4. Process all matches in parallel (only if no conflicts)
  const results = await Promise.allSettled(
    payload.matchIds.map(async (matchId) => {
      return await updateProjectMatch(ownerSub, projectId, matchId, {
        status: "accepted",
        comment: payload.comment,
      });
    })
  );

  // 5. Return summary of results
  return jsonResponse(200, {
    succeeded: succeededCount,
    failed: failedCount,
    total: payload.matchIds.length,
    failures: failedDetails
  });
}
```

### 3. Frontend Integration

**Component: `frontend/components/projects/match-suggestions-screen.tsx`**

**Key Features:**
- Real-time conflict detection and user feedback
- Optimistic UI updates with rollback on error
- Bulk operation progress tracking
- Enhanced error handling for 409 conflicts

**Accept Button Implementation:**
```typescript
const handleAccept = async (matchId: string) => {
  try {
    await updateMatchMutation.mutateAsync({
      matchId,
      status: "accepted"
    });

    // React Query automatically invalidates and refetches
    toast.success("Match accepted successfully");
  } catch (error) {
    if (error.message.includes("already matched")) {
      toast.error("Cannot accept: Response item is already matched to another ITT item");
    } else {
      toast.error(`Failed to accept match: ${error.message}`);
    }
  }
};
```

**Bulk Accept Implementation:**
```typescript
const handleBulkAccept = async (matchIds: string[]) => {
  try {
    const result = await bulkAcceptMutation.mutateAsync({
      matchIds,
      comment: bulkComment
    });

    if (result.failed > 0) {
      toast.warning(`${result.succeeded} matches accepted, ${result.failed} failed`);
    } else {
      toast.success(`All ${result.succeeded} matches accepted successfully`);
    }
  } catch (error) {
    if (error.message.includes("conflicts")) {
      const parsed = JSON.parse(error.message);
      toast.error(`Bulk accept failed: ${parsed.conflictCount} conflicts detected`);
    } else {
      toast.error(`Bulk accept failed: ${error.message}`);
    }
  }
};
```

## Data Model

### Match Entity Structure
```typescript
interface MatchEntity {
  matchId: string;           // Composite: responseItemId:ittItemId
  projectId: string;
  ittItemId: string;
  contractorId: string;
  responseItemId: string;
  status: "suggested" | "accepted" | "rejected" | "manual";
  confidence: number;        // 0.0 to 1.0
  comment?: string;
  createdAt: string;
  updatedAt: string;
}
```

### DynamoDB Storage Pattern
```typescript
// Primary Key: PK = ownerSub, SK = match#{matchId}
// GSI1: PK = project#{projectId}, SK = match#{status}#{matchId}
// GSI2: PK = project#{projectId}#{ittItemId}, SK = match#{matchId}
```

## Assessment Integration

### How Accepted Matches Flow to Assessment

Once matches are accepted, they become part of the project assessment:

**Assessment Handler:** `services/src/handlers/api/assessment.ts`

```typescript
// 1. Fetch all matches (including accepted ones)
const matches = await listProjectMatches(ownerSub, projectId, { status: "all" });

// 2. Build assessment line items
const lineItems: AssessmentLineItem[] = ittItems.map(ittItem => {
  const itemMatches = matchesByIttItem.get(ittItem.ittItemId) || [];
  const responses: Record<string, any> = {};

  itemMatches.forEach(match => {
    if (match.status === "accepted") {
      // Include in assessment calculations
      responses[contractor.contractorId] = {
        responseItemId: responseItem.responseItemId,
        amount: calculateResponseAmount(responseItem),
        matchStatus: match.status,
        // ... other response data
      };
    }
  });

  return { ittItem, responses };
});

// 3. Calculate contractor totals from accepted matches
const contractorTotals = new Map<string, number>();
lineItems.forEach(lineItem => {
  Object.values(lineItem.responses).forEach((response: any) => {
    if (response.matchStatus === "accepted" && response.amount) {
      const currentTotal = contractorTotals.get(response.contractorId) || 0;
      contractorTotals.set(response.contractorId, currentTotal + response.amount);
    }
  });
});
```

## Error Handling

### HTTP Status Codes

- **200 OK** - Match accepted successfully
- **404 Not Found** - Project or match not found
- **409 Conflict** - Conflict detected (response item already matched)
- **400 Bad Request** - Invalid payload or validation error

### Frontend Error Display

```typescript
// Conflict Error (409)
{
  message: "Response item is already matched to a different ITT item",
  details: {
    conflictingMatchId: "resp123:itt456",
    conflictingIttItemId: "itt456",
    responseItemId: "resp123"
  }
}

// Bulk Accept Conflicts (409)
{
  message: "Bulk accept failed due to conflicts",
  conflicts: [
    {
      matchId: "resp123:itt789",
      error: "Response item is already matched to a different ITT item",
      conflictDetails: { conflictingMatchId, conflictingIttItemId, responseItemId }
    }
  ],
  conflictCount: 1,
  totalRequested: 5
}
```

## Testing Strategy

### Unit Tests
- Conflict detection logic validation
- Match status transition validation
- Assessment calculation accuracy

### Integration Tests
- End-to-end accept workflow
- Bulk operation handling
- Error boundary testing

### Test Data Scenarios
```typescript
// Scenario 1: Valid acceptance
const testMatch = {
  matchId: "resp001:itt001",
  status: "suggested",
  responseItemId: "resp001",
  ittItemId: "itt001"
};

// Scenario 2: Conflict scenario
const conflictingMatch = {
  matchId: "resp001:itt002",  // Same response item, different ITT
  status: "suggested",
  responseItemId: "resp001",   // Conflict!
  ittItemId: "itt002"
};
```

## Performance Considerations

### Database Queries
- Use GSI for efficient project-scoped match queries
- Batch DynamoDB operations for bulk accepts
- Implement pagination for large match sets

### Frontend Optimizations
- React Query for automatic cache invalidation
- Optimistic updates with error rollback
- Debounced bulk operations

### Monitoring
- CloudWatch metrics for conflict rates
- Performance monitoring for bulk operations
- Error rate tracking by endpoint

## Security Considerations

### Authorization
- All operations require valid project ownership
- Match IDs are validated against project scope
- No cross-project match manipulation allowed

### Input Validation
- Zod schemas for all API payloads
- Match ID format validation
- Confidence score bounds checking

## Deployment Notes

### Environment Variables
- All Lambda functions need DynamoDB table access
- Proper IAM permissions for match operations
- SQS permissions for background processing

### CDK Configuration
```typescript
// Ensure Lambda has DynamoDB permissions
const matchApiFunction = new Function(this, "MatchApiFunction", {
  // ... other config
  environment: {
    TENDERS_TABLE_NAME: tendersTable.tableName,
    // ... other env vars
  }
});

tendersTable.grantReadWriteData(matchApiFunction);
```

## Troubleshooting

### Common Issues

1. **"Route not found" errors**
   - Ensure CDK deployment completed successfully
   - Check API Gateway route configuration
   - Verify Lambda function deployment

2. **Conflict detection not working**
   - Verify match status filtering in queries
   - Check GSI query patterns
   - Validate conflict detection logic

3. **Assessment not showing accepted matches**
   - Ensure assessment handler includes all statuses
   - Check match status filtering in assessment queries
   - Verify data aggregation logic

### Debug Commands
```bash
# Check deployment status
cd infra && npx cdk deploy --all

# Verify Lambda logs
aws logs tail /aws/lambda/Tenders-dev-Api-ApiHandler --follow

# Test API endpoints
curl -X POST https://api.example.com/projects/proj123/match/status \
  -H "Content-Type: application/json" \
  -d '{"matchId":"resp001:itt001","status":"accepted"}'
```

## Future Enhancements

### Potential Improvements
1. **Audit Trail** - Track all match status changes
2. **Bulk Reject** - Similar to bulk accept functionality
3. **Match Analytics** - Confidence score analytics
4. **Automated Testing** - Comprehensive E2E test suite
5. **Performance Monitoring** - Detailed CloudWatch dashboards

---

*This document should be updated as the Accept workflow evolves. Last updated: 2025-09-27*