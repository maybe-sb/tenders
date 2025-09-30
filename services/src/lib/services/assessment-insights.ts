import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getOpenAIClient } from "@/lib/openai";
import type { AssessmentPayload } from "@/types/api";

const ASSESSMENT_SCHEMA_DESCRIPTION = `Assessment payload schema:
{
  "project": {
    "projectId": string,
    "name": string,
    "status": string,
    "currency": string,
    "createdAt": ISO-8601 string,
    "updatedAt": ISO-8601 string
  },
  "contractors": Array<{
    "contractorId": string,
    "name": string,
    "contact"?: string,
    "totalValue"?: number
  }>,
  "sections": Array<{
    "sectionId": string,
    "code": string,
    "name": string,
    "order": number,
    "totalsByContractor": Record<string, number>,
    "totalITTAmount": number,
    "exceptionCount": number
  }>,
  "lineItems": Array<{
    "ittItem": {
      "ittItemId": string,
      "sectionId": string,
      "sectionName"?: string,
      "subSectionCode"?: string,
      "subSectionName"?: string,
      "itemCode": string,
      "description": string,
      "unit": string,
      "qty": number,
      "rate": number,
      "amount": number
    },
    "responses": Record<contractorId, {
      "responseItemId": string,
      "contractorId": string,
      "sectionGuess"?: string,
      "itemCode"?: string,
      "description": string,
      "unit"?: string,
      "qty"?: number,
      "rate"?: number,
      "amount": number | null,
      "amountLabel"?: string,
      "matchStatus": "suggested" | "accepted" | "rejected" | "manual"
    }>
  }>,
  "exceptions": Array<{
    "responseItemId": string,
    "contractorId": string,
    "contractorName": string,
    "description": string,
    "attachedSectionId"?: string,
    "amount"?: number,
    "note"?: string
  }>,
  "sectionAttachments": Record<sectionId, Array<{
    "responseItemId": string,
    "contractorId": string,
    "contractorName": string,
    "description": string,
    "amount": number | null,
    "amountLabel"?: string,
    "note"?: string
  }>>
}`;

const MAX_CONTEXT_BYTES = 900_000; // keep under ~900 KB to stay within context limits

interface BuildPromptOptions {
  projectId: string;
  assessment: AssessmentPayload;
}

function buildPrompt({ projectId, assessment }: BuildPromptOptions): { prompt: string; truncated: boolean } {
  const rawJson = JSON.stringify(assessment);
  const rawBytes = Buffer.byteLength(rawJson, "utf8");
  const truncated = rawBytes > MAX_CONTEXT_BYTES;
  const jsonSlice = truncated ? rawJson.slice(0, MAX_CONTEXT_BYTES) + "\n/* TRUNCATED */" : rawJson;

  const instructions = `You are an expert construction tender analyst comparing contractor bids on project ${assessment.project.name} (${projectId}).

Your goal is to produce a concise executive assessment with 3 to 4 paragraphs. Follow these rules:
- Start each paragraph with a short bold heading (e.g. **Pricing Anomalies**).
- Use bullet lists inside paragraphs when calling out multiple line items or contractors.
- Focus on material insights: pricing anomalies by contractor or line item, unusual qualifications or clauses, rate-only entries, different quantity assumptions, inclusions beyond scope, or other risks/opportunities for a client assessor.
- Reference specific sections or item codes where possible so the client can investigate quickly.
- Do not invent data that is not present. If information is missing, state that clearly.
- Keep the tone professional and practical.

You will receive the full assessment dataset as JSON. Review cross-contractor comparisons carefully before writing.

${ASSESSMENT_SCHEMA_DESCRIPTION}

Assessment dataset (JSON):
${jsonSlice}`;

  return { prompt: instructions, truncated };
}

export async function generateAssessmentInsights(
  projectId: string,
  assessment: AssessmentPayload
): Promise<{ insights: string; truncated: boolean; model: string }> {
  const client = getOpenAIClient();
  const { OPENAI_MODEL, OPENAI_SERVICE_TIER } = getEnv();
  const model = OPENAI_MODEL ?? "gpt-5";
  const serviceTier = OPENAI_SERVICE_TIER ?? "priority";

  const { prompt, truncated } = buildPrompt({ projectId, assessment });

  logger.info("Generating assessment insights with OpenAI", {
    projectId,
    model,
    serviceTier,
    truncated,
  });

  const response = await client.responses.create({
    model,
    service_tier: serviceTier,
    max_output_tokens: 800,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: prompt,
          },
        ],
      },
    ],
  });

  const text = response.output_text ?? response.output?.[0]?.content?.[0]?.text ?? "";
  const insights = text.trim();

  if (!insights) {
    logger.error("OpenAI returned empty insights", { projectId, response: JSON.stringify(response) });
    throw new Error("Failed to generate insights");
  }

  logger.info("Generated assessment insights", {
    projectId,
    insightPreview: insights.slice(0, 200),
  });

  return { insights, truncated, model };
}
