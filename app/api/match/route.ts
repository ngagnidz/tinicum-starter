import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { computeDiscrepancies, type PoLineRow } from "@/lib/line-matching";
import { getFxRate, type FxRate } from "@/lib/fx";

const BodySchema = z.object({
  runId: z.string().uuid(),
});

export async function POST(request: Request) {
  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { ok: false, error: "Request body must be { runId: string }" },
      { status: 400 },
    );
  }
  const { runId } = body.data;

  const supabase = await createClient();

  const [
    { data: poLines, error: poLinesError },
    { data: confirmations, error: confirmationsError },
    { data: files, error: filesError },
    { data: existingCrosswalk, error: crosswalkError },
  ] = await Promise.all([
    supabase
      .from("po_lines")
      .select(
        "id, po_number, po_date, vendor_id, vendor_name, line_number, our_pn, our_description, qty_ordered, unit_price, required_date",
      )
      .eq("run_id", runId),
    supabase
      .from("confirmations")
      .select("id, file_id, po_number, vendor_name, doc_part, currency, ack_date, ack_date_text")
      .eq("run_id", runId),
    supabase.from("confirmation_files").select("id, file_name").eq("run_id", runId),
    supabase.from("part_crosswalk").select("vendor_id, vendor_part_number, our_pn"),
  ]);

  const firstError = poLinesError || confirmationsError || filesError || crosswalkError;
  if (firstError) {
    return NextResponse.json({ ok: false, error: firstError.message }, { status: 500 });
  }

  const confirmationIds = (confirmations ?? []).map((c) => c.id);
  const { data: confirmationLines, error: linesError } = confirmationIds.length
    ? await supabase
        .from("confirmation_lines")
        .select(
          "id, confirmation_id, line_number, part_number, description, quantity, unit_of_measure, unit_price, promise_text, promise_date_start, promise_date_end, promise_basis",
        )
        .in("confirmation_id", confirmationIds)
    : { data: [], error: null };

  if (linesError) {
    return NextResponse.json({ ok: false, error: linesError.message }, { status: 500 });
  }

  // Pre-fetch all distinct FX rates needed based on PO dates and confirmation currencies.
  const poDateMonths = new Set<string>();
  for (const po of (poLines ?? []) as PoLineRow[]) {
    if (po.po_date) {
      const month = po.po_date.substring(0, 7); // YYYY-MM
      poDateMonths.add(month);
    }
  }

  const currencies = new Set((confirmations ?? []).map((c) => c.currency));
  const fxRateCache = new Map<string, FxRate | null>();
  let fxError: string | null = null;

  if (currencies.has("EUR") && poDateMonths.size > 0) {
    for (const month of poDateMonths) {
      try {
        const rate = await getFxRate(month, "EUR");
        fxRateCache.set(`${month}:EUR`, rate);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Could not fetch EUR->USD rate";
        fxError = fxError ? `${fxError}; ${msg}` : msg;
      }
    }
  }

  const getFxRateFunc = (month: string, currency: string): FxRate | null => {
    return fxRateCache.get(`${month}:${currency}`) ?? null;
  };

  const { discrepancies, newCrosswalkEntries } = computeDiscrepancies({
    poLines: poLines ?? [],
    confirmations: confirmations ?? [],
    confirmationLines: confirmationLines ?? [],
    files: files ?? [],
    existingCrosswalk: existingCrosswalk ?? [],
    getFxRate: getFxRateFunc,
  });

  // Re-runnable: clear this run's previous results first. part_crosswalk is
  // NOT run-scoped (it's persistent, cross-run learned knowledge) and is
  // never cleared here.
  const { error: deleteError } = await supabase
    .from("discrepancies")
    .delete()
    .eq("run_id", runId);
  if (deleteError) {
    return NextResponse.json({ ok: false, error: deleteError.message }, { status: 500 });
  }

  if (newCrosswalkEntries.length > 0) {
    const { error: crosswalkInsertError } = await supabase
      .from("part_crosswalk")
      .upsert(newCrosswalkEntries, { onConflict: "vendor_id,vendor_part_number", ignoreDuplicates: true });
    if (crosswalkInsertError) {
      return NextResponse.json({ ok: false, error: crosswalkInsertError.message }, { status: 500 });
    }
  }

  if (discrepancies.length > 0) {
    const { error: insertError } = await supabase
      .from("discrepancies")
      .insert(discrepancies.map((d) => ({ run_id: runId, ...d })));
    if (insertError) {
      return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 });
    }
  }

  await supabase.from("runs").update({ status: "matched" }).eq("id", runId);

  const fxRatesUsed = Array.from(fxRateCache.entries())
    .filter(([, rate]) => rate !== null)
    .map(([key, rate]) => ({
      key,
      rate: rate?.rate,
      source: rate?.source,
    }));

  return NextResponse.json({
    ok: true,
    discrepancyCount: discrepancies.length,
    newCrosswalkCount: newCrosswalkEntries.length,
    fxRatesUsed: fxRatesUsed.length > 0 ? fxRatesUsed : null,
    fxError,
  });
}
