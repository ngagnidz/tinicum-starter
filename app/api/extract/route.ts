import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { extractConfirmation } from "@/lib/anthropic/extract-confirmation";
import {
  isValidPoNumber,
  normalizeCurrency,
  parseAckDate,
  toConfirmationLineRow,
} from "@/lib/normalize";

const BodySchema = z.object({
  fileId: z.string().uuid(),
});

export async function POST(request: Request) {
  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { ok: false, error: "Request body must be { fileId: string }" },
      { status: 400 },
    );
  }
  const { fileId } = body.data;

  const supabase = await createClient();

  const { data: file, error: fileError } = await supabase
    .from("confirmation_files")
    .select("id, run_id, storage_path, file_name")
    .eq("id", fileId)
    .single();

  if (fileError || !file) {
    return NextResponse.json(
      { ok: false, error: "Unknown file id" },
      { status: 404 },
    );
  }

  const fail = async (message: string) => {
    await supabase
      .from("confirmation_files")
      .update({ status: "failed", error: message })
      .eq("id", fileId);
    return NextResponse.json({ ok: false, error: message });
  };

  const { data: blob, error: downloadError } = await supabase.storage
    .from("confirmations")
    .download(file.storage_path);

  if (downloadError || !blob) {
    return fail(`Could not download from storage: ${downloadError?.message ?? "unknown error"}`);
  }

  let extraction;
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    extraction = await extractConfirmation(base64);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Extraction failed");
  }

  // A document that acknowledges the PO but confirms no line items yet
  // (e.g. "schedule TBD") is a legitimate outcome, not a failure -- it's
  // saved with zero confirmation_lines and shows up as "Acknowledged, no
  // details" in line-level matching (lib/line-matching.ts).
  const currency = normalizeCurrency(extraction.currency);
  const lineRows = extraction.lines.map((line) =>
    toConfirmationLineRow(line, currency),
  );

  const reviewReasons: string[] = [];
  if (!isValidPoNumber(extraction.po_number)) {
    reviewReasons.push(
      `po_number "${extraction.po_number ?? "null"}" is missing or not in PO-XXXXXXXXXX format`,
    );
  }
  const reviewLineCount = lineRows.filter((l) => l.needs_review).length;
  if (reviewLineCount > 0) {
    reviewReasons.push(
      `${reviewLineCount} line(s) flagged for review (unparseable promise date or non-positive quantity/price)`,
    );
  }
  const needsReview = reviewReasons.length > 0;

  const { data: confirmation, error: insertError } = await supabase
    .from("confirmations")
    .insert({
      run_id: file.run_id,
      file_id: fileId,
      po_number: extraction.po_number,
      vendor_name: extraction.vendor_name,
      doc_part: extraction.doc_part,
      currency,
      ack_date_text: extraction.ack_date_text,
      ack_date: parseAckDate(extraction.ack_date_text, currency),
      raw_json: extraction,
    })
    .select("id")
    .single();

  if (insertError || !confirmation) {
    return fail(`Could not save confirmation: ${insertError?.message}`);
  }

  if (lineRows.length > 0) {
    const { error: linesError } = await supabase.from("confirmation_lines").insert(
      lineRows.map((row) => ({ confirmation_id: confirmation.id, ...row })),
    );

    if (linesError) {
      return fail(`Could not save confirmation lines: ${linesError.message}`);
    }
  }

  await supabase
    .from("confirmation_files")
    .update({
      status: "extracted",
      error: needsReview ? reviewReasons.join("; ") : null,
      needs_review: needsReview,
    })
    .eq("id", fileId);

  return NextResponse.json({ ok: true, confirmationId: confirmation.id });
}
