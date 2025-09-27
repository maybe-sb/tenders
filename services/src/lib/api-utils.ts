import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
} from "aws-lambda";

export type ApiEvent = APIGatewayProxyEvent | APIGatewayProxyEventV2;

export function getJsonBody<T>(event: ApiEvent): T {
  const rawBody = (event as APIGatewayProxyEventV2).body ?? (event as APIGatewayProxyEvent).body;
  if (!rawBody) {
    return {} as T;
  }

  const decoded = (event as APIGatewayProxyEventV2).isBase64Encoded || (event as APIGatewayProxyEvent).isBase64Encoded
    ? Buffer.from(rawBody, "base64").toString("utf8")
    : rawBody;

  try {
    return JSON.parse(decoded) as T;
  } catch (error) {
    throw new Error("INVALID_JSON_BODY");
  }
}

export function getOwnerSub(event: ApiEvent): string {
  const authorizer =
    (event as APIGatewayProxyEventV2).requestContext?.authorizer ??
    (event as APIGatewayProxyEvent).requestContext?.authorizer;

  const sub =
    (authorizer as any)?.jwt?.claims?.sub ||
    (authorizer as any)?.claims?.sub ||
    (authorizer as any)?.principalId;

  return (sub as string) ?? process.env.DEFAULT_OWNER_SUB ?? "demo-user";
}

export function getPathParam(params: Record<string, string>, key: string): string {
  const value = params[key];
  if (!value) {
    throw new Error(MISSING_PATH_PARAM_);
  }
  return value;
}

export function getQueryParam(event: ApiEvent, key: string): string | undefined {
  const v2Params = (event as APIGatewayProxyEventV2).queryStringParameters;
  if (v2Params && key in v2Params && v2Params[key] !== undefined) {
    return v2Params[key] ?? undefined;
  }

  const v1Params = (event as APIGatewayProxyEvent).queryStringParameters;
  if (v1Params && key in v1Params && v1Params[key] !== undefined) {
    return v1Params[key] ?? undefined;
  }

  return undefined;
}
