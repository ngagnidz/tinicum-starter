import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { draftVendorEmail } from "@/lib/anthropic/draft-vendor-email";
import { buildVendorEmail } from "@/lib/vendor-email";

const BodySchema = z.object({
  runId: z.string().uuid(),
  po: z.string().min(1),
});

export async function POST(request: Request) {
  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { ok: false, error: "Request body must be { runId: string, po: string }" },
      { status: 400 },
    );
  }
  const { runId, po } = body.data;

  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .from("discrepancies")
    .select(
      "vendor_name, part, issue_type, ordered_value, confirmed_value, days_late, note, severity",
    )
    .eq("run_id", runId)
    .eq("po_number", po);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No discrepancies found for this PO" },
      { status: 404 },
    );
  }

  const vendorName = rows.find((r) => r.vendor_name)?.vendor_name ?? null;

  try {
    const email = await draftVendorEmail(po, vendorName, rows);
    return NextResponse.json({ ok: true, ...email });
  } catch (err) {
    // AI draft failed (missing key, model/network error) -- fall back to a
    // deterministic template so the feature still works.
    const email = buildVendorEmail(po, vendorName, rows);
    return NextResponse.json({
      ok: true,
      ...email,
      fallback: true,
      fallbackReason: err instanceof Error ? err.message : "AI draft failed",
    });
  }
}
