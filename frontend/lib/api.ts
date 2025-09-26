import {
  AssessmentPayload,
  ExceptionRecord,
  ITTItem,
  MatchStatus,
  MatchSuggestion,
  PresignedUpload,
  ProjectDetail,
  ResponseItem,
  TenderProject,
  UploadResponse,
} from "@/types/tenders";

const ENV_SCHEMA = z.object({
  NEXT_PUBLIC_API_BASE_URL: z
    .string()
    .url()
    .or(z.string().length(0))
    .optional(),
});

const env = ENV_SCHEMA.safeParse({
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
});

const API_BASE_URL = env.success && env.data.NEXT_PUBLIC_API_BASE_URL
  ? env.data.NEXT_PUBLIC_API_BASE_URL.replace(/\/$/, "")
  : "http://localhost:4000/api/v1";

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

interface RequestOptions extends RequestInit {
  query?: Record<string, string | number | boolean | undefined>;
}

async function request<T>(
  path: string,
  method: HttpMethod,
  body?: unknown,
  options: RequestOptions = {}
): Promise<T> {
  const url = new URL(`${API_BASE_URL}${path}`);
  if (options.query) {
    Object.entries(options.query).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    });
  }

  const response = await fetch(url.toString(), {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    ...options,
  });

  if (!response.ok) {
    let message = "Unexpected error";
    try {
      const errorPayload = await response.json();
      message = errorPayload?.message ?? message;
    } catch (error) {
      if (error instanceof Error) {
        message = error.message;
      }
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const data = await response.json();
  return data as T;
}

export const api = {
  listProjects: () => request<TenderProject[]>("/projects", "GET"),
  getProject: (projectId: string) => request<TenderProject>(`/projects/${projectId}`, "GET"),
  getProjectDetail: (projectId: string) =>
    request<ProjectDetail>(`/projects/${projectId}/detail`, "GET"),
  listIttItems: (projectId: string) =>
    request<ITTItem[]>(`/projects/${projectId}/itt/items`, "GET"),
  listResponseItems: (projectId: string, params?: { unmatchedOnly?: boolean }) =>
    request<ResponseItem[]>(`/projects/${projectId}/responses/items`, "GET", undefined, {
      query: { unmatchedOnly: params?.unmatchedOnly },
    }),
  listMatches: (projectId: string, params?: { status?: MatchStatus | "all" }) =>
    request<MatchSuggestion[]>(`/projects/${projectId}/match`, "GET", undefined, {
      query: { status: params?.status },
    }),
  listExceptions: (projectId: string) =>
    request<ExceptionRecord[]>(`/projects/${projectId}/exceptions`, "GET"),
  createProject: (payload: { name: string; currency: string }) =>
    request<TenderProject>("/projects", "POST", payload),
  updateProject: (
    projectId: string,
    payload: Partial<{ name: string; status: TenderProject["status"]; currency: string }>
  ) => request<TenderProject>(`/projects/${projectId}`, "PATCH", payload),
  deleteProject: (projectId: string) => request<void>(`/projects/${projectId}`, "DELETE"),
  requestIttUpload: (projectId: string) =>
    request<{ upload: PresignedUpload }>(`/projects/${projectId}/itt/upload-url`, "POST"),
  requestResponseUpload: (projectId: string, contractorName: string) =>
    request<{ upload: PresignedUpload }>(`/projects/${projectId}/responses/upload-url`, "POST", {
      contractorName,
    }),
  confirmIttUpload: (
    projectId: string,
    payload: { key: string; fileName: string }
  ) => request<UploadResponse>(`/projects/${projectId}/itt/confirm-upload`, "POST", payload),
  confirmResponseUpload: (
    projectId: string,
    payload: { key: string; contractorId: string; fileName: string }
  ) =>
    request<UploadResponse>(`/projects/${projectId}/responses/confirm-upload`, "POST", payload),
  triggerAutoMatch: (projectId: string) =>
    request<{ enqueued: boolean }>(`/projects/${projectId}/match/auto`, "POST"),
  updateMatchStatus: (
    projectId: string,
    payload: { matchId: string; status: MatchStatus; comment?: string }
  ) => request<void>(`/projects/${projectId}/match/status`, "POST", payload),
  createManualMatch: (
    projectId: string,
    payload: { ittItemId: string; responseItemId: string }
  ) => request<void>(`/projects/${projectId}/match/manual`, "POST", payload),
  removeMatch: (
    projectId: string,
    payload: { matchId: string }
  ) => request<void>(`/projects/${projectId}/match`, "DELETE", payload),
  attachException: (
    projectId: string,
    payload: { responseItemId: string; sectionId?: string; note?: string }
  ) => request<void>(`/projects/${projectId}/exceptions`, "POST", payload),
  getAssessment: (projectId: string) =>
    request<AssessmentPayload>(`/projects/${projectId}/assessment`, "GET"),
  generateReport: (projectId: string) =>
    request<{ reportKey: string }>(`/projects/${projectId}/reports`, "POST"),
  getReportDownloadUrl: (projectId: string, reportKey: string) =>
    request<{ url: string }>(
      `/projects/${projectId}/reports/${encodeURIComponent(reportKey)}`,
      "GET"
    ),
};

export type ApiClient = typeof api;


