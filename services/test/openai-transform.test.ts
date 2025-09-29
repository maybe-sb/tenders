import { describe, expect, it } from "vitest";

import { transformGPTResponseToSchema } from "@/lib/openai";
import { OpenAIExcelResponseSchema } from "@/types/openai";

describe("transformGPTResponseToSchema", () => {
  it("coerces currency formatted strings into numeric rate and amount values", () => {
    const gptResponse = {
      doc_type: "response",
      contractor_name: "Devcon",
      primary_worksheet: "Itemised Quote",
      items: [
        {
          item_code: "1.1.1",
          description: "Site establishment",
          unit: "item",
          quantity: " 1 ",
          rate: " $18,307.67 ",
          amount: " $18,307.67 ",
          section: "1 Preliminaries > 1.1 Establishment",
        },
        {
          item_code: "1.1.2",
          description: "Traffic management",
          unit: "item",
          quantity: " 1 ",
          rate: "($7,758.23)",
          amount: "($7,758.23)",
          section: "1 Preliminaries > 1.1 Establishment",
        },
        {
          item_code: "1.1.3",
          description: "Fence works",
          unit: "m",
          quantity: " 1,160 ",
          rate: " Included ",
          amount: " Included ",
          section: "1 Preliminaries > 1.1 Establishment",
        },
      ],
      sections: [
        { code: "1", name: "Preliminaries" },
      ],
      metadata: {
        total_items: 3,
        total_worksheets: 1,
        confidence: 0.95,
        warnings: [],
      },
    };

    const transformed = transformGPTResponseToSchema(gptResponse, "response", "Devcon");
    const parsed = OpenAIExcelResponseSchema.parse(transformed);

    expect(parsed.items[0].qty).toBe(1);
    expect(parsed.items[0].rate).toBe(18307.67);
    expect(parsed.items[0].amount).toBe(18307.67);
    expect(parsed.items[0].amountLabel).toBeUndefined();

    expect(parsed.items[1].rate).toBe(-7758.23);
    expect(parsed.items[1].amount).toBe(-7758.23);
    expect(parsed.items[1].amountLabel).toBeUndefined();

    expect(parsed.items[2].qty).toBe(1160);
    expect(parsed.items[2].rate).toBeUndefined();
    expect(parsed.items[2].amount).toBeUndefined();
    expect(parsed.items[2].amountLabel).toBe("Included");
  });
});
