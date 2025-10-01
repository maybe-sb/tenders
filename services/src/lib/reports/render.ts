import type { AssessmentPayload } from "@/types/api";

interface RenderOptions {
  generatedAt?: Date;
  insights?: string | null;
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
