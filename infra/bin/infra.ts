#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";

import { resolveEnv } from "../lib/config";
import { AuthStack } from "../lib/stacks/auth-stack";
import { StorageStack } from "../lib/stacks/storage-stack";
import { DataStack } from "../lib/stacks/data-stack";
import { AiStack } from "../lib/stacks/ai-stack";
import { ApiStack } from "../lib/stacks/api-stack";

const app = new cdk.App();
const { envName } = resolveEnv();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const authStack = new AuthStack(app, `Tenders-${envName}-Auth`, {
  envName,
  env,
});

const storageStack = new StorageStack(app, `Tenders-${envName}-Storage`, {
  envName,
  env,
});

const dataStack = new DataStack(app, `Tenders-${envName}-Data`, {
  envName,
  env,
});

authStack.addDependency(storageStack);
authStack.addDependency(dataStack);

const aiStack = new AiStack(app, `Tenders-${envName}-Ai`, {
  envName,
  env,
  table: dataStack.table,
  uploadsBucket: storageStack.uploadsBucket,
  artifactsBucket: storageStack.artifactsBucket,
});

const apiStack = new ApiStack(app, `Tenders-${envName}-Api`, {
  envName,
  env,
  table: dataStack.table,
  uploadsBucket: storageStack.uploadsBucket,
  artifactsBucket: storageStack.artifactsBucket,
  matchQueue: aiStack.matchQueue,
  reportQueue: aiStack.reportQueue,
  textractQueue: aiStack.textractQueue,
});

apiStack.addDependency(aiStack);
