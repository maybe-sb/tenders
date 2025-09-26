# Tenders

A full-stack platform for managing tendering projects, comparing contractor responses, and generating assessment reports. The solution comprises a Next.js frontend, AWS Lambda-based backend microservices, and infrastructure provisioned with the AWS CDK.

## Repository Structure

- `frontend/` – Next.js (App Router) app with shadcn/ui, React Query, Zustand, and drag-and-drop workflows.
- `services/` – Lambda handlers (TypeScript) covering API routes, document extraction, matching engine, and report generation.
- `infra/` – AWS CDK stacks (Auth, Storage, Data, AI/processing, API) for provisioning Cognito, DynamoDB, S3, queues, and API Gateway integrations.

## Getting Started

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Create `frontend/.env.local` from `.env.local.example` and populate the values using the outputs from the CDK deployment.

### Services

```bash
cd services
npm install
npm run typecheck
npm run build
```

### Infrastructure

```bash
cd infra
npm install
npm run build
cdk synth
```

Set `DEPLOY_ENV`, `CDK_DEFAULT_ACCOUNT`, and `CDK_DEFAULT_REGION` before deploying. The CDK stacks output the environment variables required by the frontend.

## Deployment Workflow

1. Provision infrastructure with the CDK (`AuthStack`, `StorageStack`, `DataStack`, `AiStack`, `ApiStack`).
2. Connect the GitHub repository (`maybe-sb/tenders`) to AWS Amplify Hosting for the `frontend` directory.
3. Deploy Lambda bundles from `services` using your preferred CI/CD (future step).

## Next Steps

- Implement data access layers in `services` for DynamoDB single-table design.
- Complete Lambda business logic for extraction, matching, and reporting.
- Configure Amplify build pipeline and GitHub Actions for infra deployments.
- Add automated tests across frontend and backend packages.
