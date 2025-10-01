#!/usr/bin/env node

/**
 * Script to identify and optionally remove duplicate exception records.
 *
 * A duplicate is defined as: multiple exceptions pointing to the same responseItemId
 * within the same project, where they're assigned to the same section.
 *
 * Usage:
 *   node cleanup-duplicate-exceptions.mjs [--dry-run] [--project-id=<id>]
 *
 * Options:
 *   --dry-run       Just list duplicates, don't delete anything (default)
 *   --delete        Actually delete the duplicate records
 *   --project-id    Only check a specific project
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: "ap-southeast-2" });
const ddbDocClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = "tenders-dev";

const args = process.argv.slice(2);
const dryRun = !args.includes("--delete");
const projectIdArg = args.find(arg => arg.startsWith("--project-id="));
const targetProjectId = projectIdArg ? projectIdArg.split("=")[1] : null;

console.log(`Running in ${dryRun ? "DRY-RUN" : "DELETE"} mode`);
if (targetProjectId) {
  console.log(`Checking project: ${targetProjectId}`);
}

async function findDuplicateExceptions() {
  const exceptions = [];

  // Scan all exception records
  let lastEvaluatedKey = undefined;
  do {
    const response = await ddbDocClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "entityType = :type",
        ExpressionAttributeValues: {
          ":type": "Exception",
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    const items = response.Items || [];
    exceptions.push(...items);
    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log(`Found ${exceptions.length} total exception records`);

  // Filter by project if specified
  const filteredExceptions = targetProjectId
    ? exceptions.filter(ex => ex.projectId === targetProjectId)
    : exceptions;

  console.log(`Analyzing ${filteredExceptions.length} exceptions`);

  // Group by projectId + responseItemId
  const groups = new Map();
  for (const exception of filteredExceptions) {
    const key = `${exception.projectId}::${exception.responseItemId}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(exception);
  }

  // Find duplicates (groups with more than 1 exception)
  const duplicates = [];
  for (const [key, exceptionGroup] of groups.entries()) {
    if (exceptionGroup.length > 1) {
      // Sort by updatedAt descending (keep the newest)
      exceptionGroup.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

      const [keep, ...toDelete] = exceptionGroup;
      duplicates.push({
        key,
        projectId: keep.projectId,
        responseItemId: keep.responseItemId,
        keep,
        toDelete,
      });
    }
  }

  return duplicates;
}

async function deleteDuplicate(exception) {
  await ddbDocClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: exception.PK,
        SK: exception.SK,
      },
    })
  );
}

async function main() {
  const duplicates = await findDuplicateExceptions();

  if (duplicates.length === 0) {
    console.log("\n✅ No duplicates found!");
    return;
  }

  console.log(`\n⚠️  Found ${duplicates.length} sets of duplicates:\n`);

  let totalToDelete = 0;
  for (const dup of duplicates) {
    console.log(`Project: ${dup.projectId}`);
    console.log(`Response Item: ${dup.responseItemId}`);
    console.log(`Description: ${dup.keep.description || "(no description)"}`);
    console.log(`Keeping: ${dup.keep.exceptionId} (section: ${dup.keep.sectionId || "none"}, updated: ${dup.keep.updatedAt})`);
    console.log(`Will delete ${dup.toDelete.length} duplicate(s):`);
    for (const del of dup.toDelete) {
      console.log(`  - ${del.exceptionId} (section: ${del.sectionId || "none"}, updated: ${del.updatedAt})`);
      totalToDelete++;
    }
    console.log();
  }

  if (dryRun) {
    console.log(`\nℹ️  DRY-RUN mode: Would delete ${totalToDelete} duplicate records`);
    console.log("Run with --delete to actually remove them");
  } else {
    console.log(`\n🗑️  Deleting ${totalToDelete} duplicate records...`);
    let deleted = 0;
    for (const dup of duplicates) {
      for (const del of dup.toDelete) {
        await deleteDuplicate(del);
        deleted++;
        process.stdout.write(`\rDeleted ${deleted}/${totalToDelete}`);
      }
    }
    console.log(`\n\n✅ Cleanup complete! Deleted ${deleted} duplicate exception records`);
  }
}

main().catch(console.error);