import Anthropic from "@anthropic-ai/sdk";
import { humanizeIssueType } from "@/lib/issue-labels";
import type { VendorEmailIssue } from "@/lib/vendor-email";

const MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT = `You draft short, professional emails from a procurement team to a \
vendor, flagging discrepancies an automated matching platform found between a \
purchase order and the vendor's order confirmation, and asking the vendor to \
review and confirm corrected details.

Return ONLY a single JSON object, no markdown code fences, no commentary \
before or after it: {"subject": string, "body": string}

Guidelines:
- "subject": short, references the PO number.
- "body": plain text (no markdown, no bullet characters beyond simple "-"), \
starting with a brief greeting, then the discrepancies described in plain, \
courteous language (not just restating raw data), then a closing asking the \
vendor to confirm or correct the flagged items and reply with updated details. \
Sign off with "Lisa" (procurement contact) -- no last name or title needed.
- Keep it concise -- procurement professionals read many of these.`;

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  return JSON.parse(candidate);
}

export async function draftVendorEmail(
  poNumber: string,
  vendorName: string | null,
  issues: VendorEmailIssue[],
): Promise<{ subject: string; body: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const client = new Anthropic({ apiKey });

  const issuesText = issues
    .map((issue, i) => {
      const bits = [`${i + 1}. ${humanizeIssueType(issue.issue_type)}`];
      if (issue.part) bits.push(`part ${issue.part}`);
      if (issue.ordered_value) bits.push(`ordered: ${issue.ordered_value}`);
      if (issue.confirmed_value) {
        const late = issue.days_late !== null ? ` (${issue.days_late} days late)` : "";
        bits.push(`confirmed: ${issue.confirmed_value}${late}`);
      }
      if (issue.note) bits.push(`note: ${issue.note}`);
      return bits.join(" — ");
    })
    .join("\n");

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `PO number: ${poNumber}\nVendor: ${vendorName ?? "Unknown vendor"}\n\nDiscrepancies our matching platform found:\n${issuesText}\n\nDraft the email.`,
      },
    ],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Model returned no text content");
  }

  let parsed: unknown;
  try {
    parsed = extractJson(textBlock.text);
  } catch {
    throw new Error(`Model response was not valid JSON: ${textBlock.text.slice(0, 500)}`);
  }

  const result = parsed as { subject?: unknown; body?: unknown };
  if (typeof result.subject !== "string" || typeof result.body !== "string") {
    throw new Error("Model response missing subject/body");
  }

  return { subject: result.subject, body: result.body };
}
