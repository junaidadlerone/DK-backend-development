import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getPostGridTemplate } from "../_shared/postgrid.ts";

/**
 * Audit Universal Templates Edge Function
 *
 * Loads every universal template (is_universal = true) from the templates
 * table, verifies each one against PostGrid, and builds a status report.
 *
 * If no issues are detected the report is returned but NOT persisted.
 * If any issues are detected the function:
 *   1. Generates a plain-English summary via OpenAI
 *   2. Saves the report + summary to template_audit_reports
 *   3. Returns the saved record id alongside the full report
 *
 * Status categories
 * ─────────────────
 * "active"                – not deleted in DB, exists on PostGrid
 * "deleted_from_postgrid" – not deleted in DB, but absent on PostGrid
 * "deleted_in_db_only"    – soft-deleted in DB, still present on PostGrid
 * "deleted_everywhere"    – soft-deleted in DB AND absent on PostGrid
 * "check_error"           – PostGrid API call failed (network / auth)
 *
 * Method: GET (no request body required)
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const OPENAI_API_KEY = Deno.env.get("OPENAI_KEY");
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

// ── Types ─────────────────────────────────────────────────────────────────────

interface UniversalTemplateRow {
  id: string;
  postgrid_template_id: string;
  description: string | null;
  template_type: string;
  postcard_size: string;
  live: boolean | null;
  deleted: boolean | null;
  created_at: string;
  updated_at: string;
}

type TemplateStatus =
  | "active"
  | "deleted_from_postgrid"
  | "deleted_in_db_only"
  | "deleted_everywhere"
  | "check_error";

interface TemplateAuditEntry {
  id: string;
  postgrid_template_id: string;
  description: string | null;
  template_type: string;
  postcard_size: string;
  status: TemplateStatus;
  db: {
    live: boolean;
    deleted: boolean;
    created_at: string;
    updated_at: string;
  };
  postgrid: {
    exists: boolean;
    live: boolean | null;
    error: string | null;
  };
}

interface AuditSummary {
  total: number;
  active: number;
  deleted_from_postgrid: number;
  deleted_in_db_only: number;
  deleted_everywhere: number;
  check_errors: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function deriveStatus(
  deletedInDb: boolean,
  existsOnPostgrid: boolean,
  checkFailed: boolean
): TemplateStatus {
  if (checkFailed) return "check_error";
  if (!deletedInDb && existsOnPostgrid) return "active";
  if (!deletedInDb && !existsOnPostgrid) return "deleted_from_postgrid";
  if (deletedInDb && existsOnPostgrid) return "deleted_in_db_only";
  return "deleted_everywhere";
}

function hasIssues(summary: AuditSummary): boolean {
  return (
    summary.deleted_from_postgrid > 0 ||
    summary.deleted_in_db_only > 0 ||
    summary.deleted_everywhere > 0 ||
    summary.check_errors > 0
  );
}

/**
 * Calls OpenAI to produce a concise plain-English summary of the audit findings.
 * Returns null without throwing if the API key is missing or the call fails,
 * so the audit report is always saved even when summarisation fails.
 */
async function generateOpenAISummary(
  summary: AuditSummary,
  entries: TemplateAuditEntry[]
): Promise<string | null> {
  if (!OPENAI_API_KEY) {
    console.warn("OPENAI_KEY is not set – skipping AI summary");
    return null;
  }

  const issueEntries = entries.filter((e) => e.status !== "active");
  const issueLines = issueEntries
    .map(
      (e) =>
        `  • [${e.status}] "${e.description ?? e.postgrid_template_id}" ` +
        `(PostGrid ID: ${e.postgrid_template_id}, type: ${e.template_type}, size: ${e.postcard_size})` +
        (e.postgrid.error ? ` — error: ${e.postgrid.error}` : "")
    )
    .join("\n");

  const prompt =
    `You are an internal system monitoring assistant. ` +
    `A scheduled audit of universal postcard templates has just completed. ` +
    `Summarise the findings in 3-5 concise sentences suitable for a technical admin. ` +
    `Be direct and highlight any action items.\n\n` +
    `Audit summary:\n` +
    `  Total templates checked : ${summary.total}\n` +
    `  Active (healthy)        : ${summary.active}\n` +
    `  Deleted from PostGrid   : ${summary.deleted_from_postgrid}\n` +
    `  Deleted in DB only      : ${summary.deleted_in_db_only}\n` +
    `  Deleted everywhere      : ${summary.deleted_everywhere}\n` +
    `  Check errors            : ${summary.check_errors}\n\n` +
    `Affected templates:\n${issueLines}`;

  try {
    const response = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 300,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`OpenAI API error (${response.status}): ${errorText}`);
      return null;
    }

    const data = await response.json() as {
      choices: { message: { content: string } }[];
    };
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (err) {
    console.error("OpenAI request failed:", err);
    return null;
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();

  if (req.method !== "GET") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only GET method is allowed", 405);
  }

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();

    const user = getUserFromRequest(req);
    if (!user) {
      return errorResponse("UNAUTHORIZED", "Unable to authenticate user", 401);
    }

    // ── 1. Load all universal templates ───────────────────────────────────
    const { data: templates, error: fetchError } = await supabase
      .from("templates")
      .select(
        "id, postgrid_template_id, description, template_type, postcard_size, live, deleted, created_at, updated_at"
      )
      .eq("is_universal", true)
      .order("created_at", { ascending: false })
      .returns<UniversalTemplateRow[]>();

    if (fetchError) {
      console.error("Error fetching universal templates:", fetchError);
      return errorResponse(
        "DATABASE_ERROR",
        "Failed to fetch universal templates from the database",
        500
      );
    }

    if (!templates || templates.length === 0) {
      return successResponse({
        status: "success",
        message: "No universal templates found in the database",
        saved: false,
        report: {
          summary: {
            total: 0,
            active: 0,
            deleted_from_postgrid: 0,
            deleted_in_db_only: 0,
            deleted_everywhere: 0,
            check_errors: 0,
          },
          templates: [],
        },
        processingTimeMs: Date.now() - startTime,
      });
    }

    // ── 2. Verify each template against PostGrid in parallel ──────────────
    const settledResults = await Promise.allSettled(
      templates.map((t) => getPostGridTemplate(t.postgrid_template_id))
    );

    // ── 3. Build per-template audit entries ───────────────────────────────
    const auditEntries: TemplateAuditEntry[] = templates.map((template, i) => {
      const settled = settledResults[i];
      const checkFailed = settled.status === "rejected";

      let exists = false;
      let postgridLive: boolean | null = null;
      let postgridError: string | null = null;

      if (checkFailed) {
        postgridError = (settled.reason as Error)?.message ?? "Unknown error";
        console.error(
          `PostGrid check failed for ${template.postgrid_template_id}:`,
          postgridError
        );
      } else {
        exists = settled.value.exists;
        postgridError = settled.value.error ?? null;
        if (exists && settled.value.data) {
          const pgData = settled.value.data as Record<string, unknown>;
          postgridLive = typeof pgData.live === "boolean" ? pgData.live : null;
        }
      }

      return {
        id: template.id,
        postgrid_template_id: template.postgrid_template_id,
        description: template.description ?? null,
        template_type: template.template_type,
        postcard_size: template.postcard_size,
        status: deriveStatus(template.deleted ?? false, exists, checkFailed),
        db: {
          live: template.live ?? false,
          deleted: template.deleted ?? false,
          created_at: template.created_at,
          updated_at: template.updated_at,
        },
        postgrid: {
          exists,
          live: postgridLive,
          error: postgridError,
        },
      };
    });

    // ── 4. Build summary counts ────────────────────────────────────────────
    const summary: AuditSummary = {
      total: auditEntries.length,
      active: 0,
      deleted_from_postgrid: 0,
      deleted_in_db_only: 0,
      deleted_everywhere: 0,
      check_errors: 0,
    };

    for (const entry of auditEntries) {
      if (entry.status === "check_error") {
        summary.check_errors++;
      } else {
        summary[entry.status]++;
      }
    }

    // ── 5. No issues → return without saving ─────────────────────────────
    if (!hasIssues(summary)) {
      return successResponse({
        status: "success",
        message: `All ${summary.total} universal template(s) are healthy — no report saved`,
        saved: false,
        report: { summary, templates: auditEntries },
        processingTimeMs: Date.now() - startTime,
      });
    }

    // ── 6. Issues found → generate OpenAI summary ─────────────────────────
    const openaiSummary = await generateOpenAISummary(summary, auditEntries);

    // ── 7. Persist the report ──────────────────────────────────────────────
    const { data: savedReport, error: insertError } = await supabase
      .from("template_audit_reports")
      .insert({
        total: summary.total,
        active: summary.active,
        deleted_from_postgrid: summary.deleted_from_postgrid,
        deleted_in_db_only: summary.deleted_in_db_only,
        deleted_everywhere: summary.deleted_everywhere,
        check_errors: summary.check_errors,
        report_data: auditEntries,
        openai_summary: openaiSummary,
      })
      .select("id, run_at")
      .single();

    if (insertError) {
      // Log and continue — still return the report even if the save failed
      console.error("Failed to save audit report:", insertError);
    }

    // ── 8. Build response message ─────────────────────────────────────────
    const parts: string[] = [];
    if (summary.deleted_from_postgrid > 0) {
      parts.push(`${summary.deleted_from_postgrid} template(s) deleted from PostGrid`);
    }
    if (summary.deleted_in_db_only > 0) {
      parts.push(`${summary.deleted_in_db_only} template(s) deleted in DB only`);
    }
    if (summary.deleted_everywhere > 0) {
      parts.push(`${summary.deleted_everywhere} template(s) deleted everywhere`);
    }
    if (summary.check_errors > 0) {
      parts.push(`${summary.check_errors} template(s) could not be verified`);
    }

    return successResponse({
      status: "success",
      message: parts.join(", "),
      saved: !insertError,
      audit_report_id: savedReport?.id ?? null,
      run_at: savedReport?.run_at ?? null,
      openai_summary: openaiSummary,
      report: { summary, templates: auditEntries },
      processingTimeMs: Date.now() - startTime,
    });
  } catch (error) {
    console.error("Unexpected error in auditUniversalTemplates:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${(error as Error).message}`,
      500
    );
  }
});
