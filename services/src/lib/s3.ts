import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";

const s3Client = new S3Client({});

const DEFAULT_EXPIRY_SECONDS = 15 * 60;
const DEFAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50MB

export interface PresignedPostRequest {
  bucket: string;
  key: string;
  expiresInSeconds?: number;
  fields?: Record<string, string>;
  conditions?: Array<Record<string, string> | string[]>;
  maxUploadBytes?: number;
}

export interface PresignedPostResult {
  uploadUrl: string;
  fields: Record<string, string>;
  key: string;
  expiresAt: string;
}

export async function createPresignedUploadPost(request: PresignedPostRequest): Promise<PresignedPostResult> {
  const expires = request.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS;
  const maxBytes = request.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;

  const { url, fields } = await createPresignedPost(s3Client, {
    Bucket: request.bucket,
    Key: request.key,
    Expires: expires,
    Fields: {
      key: request.key,
      ...(request.fields ?? {}),
    },
    Conditions: [
      ["content-length-range", 0, maxBytes],
      ...(request.conditions ?? []),
    ],
  });

  return {
    uploadUrl: url,
    fields,
    key: request.key,
    expiresAt: new Date(Date.now() + expires * 1000).toISOString(),
  };
}

export { s3Client };
