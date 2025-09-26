export interface TendersStackProps {
  envName: string;
  githubRepo?: string;
}

export function resolveEnv(): TendersStackProps {
  const envName = process.env.DEPLOY_ENV ?? "dev";
  const githubRepo = process.env.GITHUB_REPO ?? "maybe-sb/tenders";
  return { envName, githubRepo };
}
