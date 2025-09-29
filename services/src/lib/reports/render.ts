import type { AssessmentPayload } from "@/types/api";

interface RenderOptions {
  generatedAt?: Date;
}

export function renderAssessmentSummaryHtml(
  assessment: AssessmentPayload,
  options: RenderOptions = {}
): string {
  const generatedAt = options.generatedAt ?? new Date();
  const contractors = [...assessment.contractors];
  const sections = [...assessment.sections].sort((a, b) => a.order - b.order);
  const currency = assessment.project.currency || "AUD";
  const formatter = buildCurrencyFormatter(currency);

  const totalsByContractor = new Map(
    contractors.map((contractor) => [contractor.contractorId, contractor.totalValue ?? 0])
  );

  const totalIttAmount = sections.reduce((sum, section) => sum + section.totalITTAmount, 0);

  const projectTitle = escapeHtml(assessment.project.name || "Tender Assessment");
  const generatedLabel = generatedAt.toLocaleString("en-AU", {
    dateStyle: "long",
    timeStyle: "short",
  });

  const sectionRows = sections
    .map((section) => {
      const contractorCells = contractors
        .map((contractor) => {
          const value = section.totalsByContractor[contractor.contractorId];
          return `<td class="numeric">${formatAmount(value, formatter)}</td>`;
        })
        .join("");

      return `
        <tr>
          <td>
            <div class="section-code">${escapeHtml(section.code)}</div>
            <div class="section-name">${escapeHtml(section.name)}</div>
          </td>
          ${contractorCells}
          <td class="numeric">${formatAmount(section.totalITTAmount, formatter)}</td>
        </tr>
      `;
    })
    .join("");

  const totalsRow = `
    <tr>
      <th scope="row">Project total</th>
      ${contractors
        .map((contractor) => {
          const total = totalsByContractor.get(contractor.contractorId) ?? 0;
          return `<td class="numeric">${formatAmount(total, formatter)}</td>`;
        })
        .join("")}
      <td class="numeric">${formatAmount(totalIttAmount, formatter)}</td>
    </tr>
  `;

  const contractorLegend = contractors
    .map((contractor) => `<li>${escapeHtml(contractor.name)}</li>`)
    .join("");

  return `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>${projectTitle} — Assessment Summary</title>
        <style>
          *, *::before, *::after { box-sizing: border-box; }
          body {
            font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
            font-size: 12px;
            line-height: 1.5;
            color: #0f172a;
            margin: 0;
            padding: 32px 40px;
            background: #f8fafc;
          }
          h1 {
            font-size: 26px;
            margin: 0 0 4px;
            color: #0f172a;
          }
          h2 {
            font-size: 16px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            margin: 32px 0 12px;
            color: #475569;
          }
          p {
            margin: 0 0 6px;
            color: #475569;
          }
          .meta {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            margin-bottom: 24px;
          }
          .meta span {
            font-size: 12px;
            color: #64748b;
          }
          .summary-table {
            width: 100%;
            border-collapse: collapse;
            background: white;
            box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12);
            border-radius: 12px;
            overflow: hidden;
          }
          .summary-table th,
          .summary-table td {
            padding: 12px 14px;
            border-bottom: 1px solid #e2e8f0;
            vertical-align: top;
          }
          .summary-table thead th {
            background: #0f172a;
            color: white;
            font-weight: 600;
            text-transform: uppercase;
            font-size: 11px;
            letter-spacing: 0.08em;
          }
          .summary-table tbody tr:nth-child(even) {
            background: #f8fafc;
          }
          .summary-table tbody tr:last-child td {
            border-bottom: none;
          }
          .summary-table tfoot th,
          .summary-table tfoot td {
            background: #0f172a;
            color: white;
            border-bottom: none;
            font-weight: 600;
          }
          .numeric {
            text-align: right;
            white-space: nowrap;
            font-variant-numeric: tabular-nums;
          }
          .section-code {
            font-weight: 600;
            color: #0f172a;
          }
          .section-name {
            color: #475569;
          }
          .legend {
            margin-top: 18px;
            color: #64748b;
            font-size: 11px;
          }
          .legend ul {
            padding-left: 16px;
            margin: 6px 0 0;
          }
          .legend li {
            margin-bottom: 2px;
          }
          .project-total {
            margin-top: 24px;
            padding: 16px 20px;
            background: #0f172a;
            color: white;
            border-radius: 12px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 16px;
            font-weight: 600;
          }
          footer {
            margin-top: 40px;
            font-size: 10px;
            color: #94a3b8;
            text-align: center;
          }
        </style>
      </head>
      <body>
        <header class="meta">
          <div>
            <h1>${projectTitle}</h1>
            <p>Assessment summary for matched contractor responses.</p>
          </div>
          <span>Generated ${escapeHtml(generatedLabel)}</span>
        </header>

        <h2>Section totals</h2>
        <table class="summary-table">
          <thead>
            <tr>
              <th scope="col">Section</th>
              ${contractors.map((contractor) => `<th scope="col">${escapeHtml(contractor.name)}</th>`).join("")}
              <th scope="col">ITT Total</th>
            </tr>
          </thead>
          <tbody>
            ${sectionRows || `<tr><td colspan="${contractors.length + 2}">No sections available.</td></tr>`}
          </tbody>
          <tfoot>
            ${totalsRow}
          </tfoot>
        </table>

        <div class="legend">
          <p>Contractors included in this comparison:</p>
          <ul>${contractorLegend || "<li>No contractors available</li>"}</ul>
        </div>

        <div class="project-total">
          <span>Total tender value (ITT)</span>
          <span>${formatAmount(totalIttAmount, formatter)}</span>
        </div>

        <footer>
          Generated by Tenders assessment tool — Section summary based on accepted matches only.
        </footer>
      </body>
    </html>`;
}

function buildCurrencyFormatter(currency: string): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat("en-AU", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch (error) {
    return new Intl.NumberFormat("en-AU", {
      style: "currency",
      currency: "AUD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
}

function formatAmount(value: number | undefined, formatter: Intl.NumberFormat): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return formatter.format(value);
  }
  return "—";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
