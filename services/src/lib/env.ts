import { z } from "zod";

const EnvSchema = z.object({
  TABLE_NAME: z.string(),
  UPLOADS_BUCKET: z.string(),
  ARTIFACTS_BUCKET: z.string(),
  MATCH_QUEUE_URL: z.string().optional(),
  REPORT_QUEUE_URL: z.string().optional(),
  TEXTRACT_QUEUE_URL: z.string().optional(),
  REPORT_TEMPLATE_BUCKET: z.string().optional(),
  AWS_REGION: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional().default("gpt-5"),
  OPENAI_SERVICE_TIER: z.string().optional().default("priority"),
});

type EnvConfig = z.infer<typeof EnvSchema>;

let cached: EnvConfig | null = null;

export function getEnv(): EnvConfig {
  if (!cached) {
    cached = EnvSchema.parse(process.env);
  }
  return cached;
}
