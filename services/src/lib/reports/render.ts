import type { AssessmentPayload } from "@/types/api";

interface RenderOptions {
  generatedAt?: Date;
  insights?: string | null;
}

const ENSPIRE_LOGO_DATA_URI =
  "data:image/png;base64,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";

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

  const projectTitle = escapeHtml(assessment.project.name || "Tender Assessment");
  const generatedLabel = generatedAt.toLocaleString("en-AU", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Australia/Sydney",
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
        </tr>
      `;
    })
    .join("");

  const totalsRow = `
    <tr>
      <th scope="row">Totals</th>
      ${contractors
        .map((contractor) => {
          const total = totalsByContractor.get(contractor.contractorId) ?? 0;
          return `<td class="numeric">${formatAmount(total, formatter)}</td>`;
        })
        .join("")}
    </tr>
  `;

  const contractorLegend = contractors
    .map((contractor) => `<li>${escapeHtml(contractor.name)}</li>`)
    .join("");

  const totalsGrid = contractors
    .map((contractor) => {
      const total = totalsByContractor.get(contractor.contractorId) ?? 0;
      return `
        <div class="total-card">
          <span class="card-label">${escapeHtml(contractor.name)}</span>
          <span class="card-value">${formatAmount(total, formatter)}</span>
        </div>
      `;
    })
    .join("");

  const insightsHtml = convertInsightsToHtml(options.insights);

  return `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>${projectTitle} — Assessment Summary</title>
        <style>
          @page { size: A4 landscape; margin: 14mm 18mm; }
          *, *::before, *::after { box-sizing: border-box; }
          body {
            font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
            font-size: 12px;
            line-height: 1.5;
            color: #0f172a;
            margin: 0;
            background: #f1f5f9;
          }
          .cover {
            min-height: calc(100vh - 20mm);
            padding: 60px 70px 48px;
            background: white;
            display: flex;
            flex-direction: column;
            justify-content: flex-start;
          }
          .cover-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 48px;
          }
          .cover-logo {
            width: 180px;
            max-width: 35%;
            height: auto;
            object-fit: contain;
            display: block;
          }
          .cover-title {
            flex: 1;
            text-align: center;
          }
          .cover-title h1 {
            font-size: 30px;
            margin: 0;
            color: #0f172a;
          }
          .cover-subheading {
            margin: 8px 0 0;
            font-size: 16px;
            color: #475569;
            text-transform: uppercase;
            letter-spacing: 0.08em;
          }
          .cover-generated {
            font-size: 12px;
            color: #64748b;
            max-width: 160px;
            text-align: right;
          }
          .cover-insights {
            margin-top: 28px;
          }
          .cover-insights h2 {
            font-size: 18px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            margin: 0 0 16px;
            color: #0f172a;
          }
          .cover-insights h3 {
            margin: 18px 0 8px;
            font-size: 14px;
            color: #0f172a;
          }
          .cover-insights p {
            margin: 8px 0;
            color: #334155;
          }
          .cover-insights ul {
            margin: 0 0 12px 20px;
            padding: 0;
            color: #334155;
          }
          .cover-insights li {
            margin-bottom: 6px;
          }
          .insights-empty {
            color: #94a3b8;
            font-style: italic;
          }
          .page-break { page-break-before: always; }
          .content {
            min-height: calc(100vh - 20mm);
            padding: 32px 36px 36px;
            background: white;
          }
          h2 {
            font-size: 16px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            margin: 0 0 12px;
            color: #475569;
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
          .totals-grid {
            margin-top: 24px;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 12px;
          }
          .total-card {
            background: #0f172a;
            color: white;
            border-radius: 10px;
            padding: 16px 18px;
            display: flex;
            flex-direction: column;
            gap: 4px;
          }
          .card-label {
            font-size: 12px;
            letter-spacing: 0.04em;
            text-transform: uppercase;
            color: rgba(255, 255, 255, 0.7);
          }
          .card-value {
            font-size: 16px;
            font-weight: 600;
          }
          footer {
            margin-top: 36px;
            font-size: 10px;
            color: #94a3b8;
            text-align: center;
          }
        </style>
      </head>
      <body>
        <section class="cover">
          <div class="cover-header">
            <img src="${ENSPIRE_LOGO_DATA_URI}" alt="Enspire" class="cover-logo" />
            <div class="cover-title">
              <h1>${projectTitle}</h1>
              <p class="cover-subheading">Preliminary AI-Generated Tender Assessment</p>
            </div>
            <div class="cover-generated">Generated ${escapeHtml(generatedLabel)}</div>
          </div>
          <div class="cover-insights">
            <h2>AI Insights</h2>
            ${insightsHtml}
          </div>
        </section>
        <div class="page-break"></div>
        <section class="content">
          <h2>Section totals</h2>
          <table class="summary-table">
            <thead>
              <tr>
                <th scope="col">Section</th>
                ${contractors.map((contractor) => `<th scope="col">${escapeHtml(contractor.name)}</th>`).join("")}
              </tr>
            </thead>
            <tbody>
              ${sectionRows || `<tr><td colspan="${contractors.length + 1}">No sections available.</td></tr>`}
            </tbody>
            <tfoot>
              ${contractors.length ? totalsRow : ""}
            </tfoot>
          </table>

          <div class="legend">
            <p>Contractors included in this comparison:</p>
            <ul>${contractorLegend || "<li>No contractors available</li>"}</ul>
          </div>

          ${totalsGrid ? `<div class="totals-grid">${totalsGrid}</div>` : ""}

          <footer>Generated by Tenders assessment tool — Section summary based on accepted matches only.</footer>
        </section>
      </body>
    </html>`;
}


function convertInsightsToHtml(insights?: string | null): string {
  if (!insights) {
    return '<p class="insights-empty">AI insights were not available at the time of export.</p>';
  }

  const lines = insights.split(/\r?\n/);
  const parts: string[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length) {
      parts.push(`<ul>${listItems.join('')}</ul>`);
      listItems = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.*)/);
    const numberedMatch = line.match(/^(\d+)\.\s+(.*)/);
    if (bulletMatch || numberedMatch) {
      const content = bulletMatch ? bulletMatch[1] : numberedMatch![2];
      listItems.push(`<li>${formatInline(content)}</li>`);
      continue;
    }

    flushList();

    const headingMatch = line.match(/^\*\*(.+?)\*\*:?$/);
    if (headingMatch) {
      parts.push(`<h3>${escapeHtml(headingMatch[1])}</h3>`);
      continue;
    }

    parts.push(`<p>${formatInline(line)}</p>`);
  }

  flushList();

  return parts.join('') || '<p class="insights-empty">AI insights were not available at the time of export.</p>';
}

function formatInline(text: string): string {
  const escaped = escapeHtml(text);
  return escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
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
