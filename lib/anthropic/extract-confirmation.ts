import Anthropic from "@anthropic-ai/sdk";
import { ExtractionSchema, type Extraction } from "@/lib/schema/confirmation";

const MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT = `You extract structured data from vendor purchase-order confirmation \
documents (order acknowledgments, sales order confirmations, process order \
acknowledgments, or informal email confirmations) for a procurement team. \
The documents come from many different vendors with different templates and \
layouts -- a table, a label/value form, a scanned image, or an email body. \
Some are in languages other than English.

Return ONLY a single JSON object, no markdown code fences, no commentary \
before or after it. It must match exactly this shape:

{
  "po_number": string | null,
  "vendor_name": string | null,
  "currency": string | null,
  "doc_part": string | null,
  "ack_date_text": string | null,
  "lines": [
    {
      "line_number": number | null,
      "part_number": string | null,
      "description": string | null,
      "quantity": number | null,
      "unit_of_measure": string | null,
      "unit_price": number | null,
      "promise_text": string | null
    }
  ]
}

Every confirmation, from any vendor, produces this same shape -- there is no \
per-vendor variation in the JSON structure itself, only in which fields end \
up null (see the vendor notes below).

General rules:
- Return only JSON matching this shape, no markdown code fences, no \
commentary before or after it.
- If a field is not present in the document, or you are not confident about \
its value, use null. Never infer, guess, or compute a value that is not \
directly supported by the document text -- in particular, do not compute or \
reformat dates yourself, just copy them (see promise_text below).
- Numbers ("quantity", "unit_price"): plain JSON numbers. Strip thousands \
separators and currency symbols, e.g. "1,500" -> 1500, "€1140.8000" -> 1140.8, \
"$0.8400" -> 0.84. Do not round or convert currency.
- Documents may be laid out as a table, a label/value form, a scanned image, \
or free-text email -- read whichever it is.
- "po_number": the customer's (Beacon Fasteners') purchase order number, \
normalized to the form "PO-" followed by digits only, uppercase, no internal \
spaces (e.g. "PO-4500050001"), even if the document renders it with \
different spacing/casing. If none appears, use null -- do not invent one.
- "vendor_name": identify the vendor from its letterhead or sender address, \
never from a file name -- you won't be told the file name anyway.
- "currency": copy whatever currency symbol or code is printed (e.g. "$", \
"€", "EUR") -- do not convert it to a code yourself. If none is visible \
anywhere in the document, use null.
- "doc_part": if the document explicitly indicates it is one part of a \
multi-part shipment/confirmation for the same PO (e.g. "part 1 of 2"), copy \
that as "1 of 2" (digits and "of", exactly that shape). Otherwise null.
- "ack_date_text": the date the vendor issued THIS document -- not a \
promise/delivery date. Copy it EXACTLY as printed, character for character, \
do not normalize or reformat it. See the vendor notes below for where this \
is usually labeled; if you can't find an issue date, use null.
- "part_number": whatever identifier the vendor prints for the line item -- \
a Beacon part number, the vendor's own part number, or a process code (e.g. \
"PASV") -- exactly as printed. There is one field for this, not a choice \
between several.
- "description": null if the document only refers you elsewhere for it \
(e.g. "see PO for description", "siehe Bestellung") rather than actually \
describing the item.
- "promise_text": copy the delivery/promise date or date range EXACTLY as \
printed, character for character (e.g. "05/21/2026", "08.06.2026", \
"KW 20-22 / 2026", "ship 05/21/2026"). If the document's terms elsewhere \
state the delivery is Ex Works/EXW for this line, prefix the copied text \
with "EXW " (e.g. "EXW KW 20-22 / 2026"). Otherwise do not normalize, \
parse, add to, or reformat it in any way.
- "lines": one entry per line item, in the order they appear. If the \
document confirms zero line items (e.g. a bare acknowledgment of receipt \
with no quantities), return an empty array.

Vendor-specific notes -- apply the one matching the vendor you identified, \
not the file name. Fields not mentioned for a vendor are simply whatever \
the general rules above produce (usually null, since that vendor's \
documents don't show them). For an unrecognized vendor, apply only the \
general rules.
- Apex Bar & Tube: a table with columns Line, Customer PN, Qty, Unit Price, \
Promise Date. "Line" -> line_number, "Customer PN" -> part_number, \
"Promise Date" -> promise_text. Apex sells discrete piece-count items (bar \
stock); if no unit is shown in the table, unit_of_measure = "EA". \
"Acknowledgment Date" -> ack_date_text.
- Heritage Cold Heading: a table where "Item" is the line number and "Our \
P/N" is Heritage's own part number (not Beacon's) -> part_number. The \
column headed "Unit" is the unit price -> unit_price. "Issued" -> \
ack_date_text.
- Liberty Surface Finishing: no line numbers or prices on these documents -- \
leave line_number and unit_price null. The "Process" column (values like \
"PASV", "CAD") -> part_number. May state "part N of M" -> doc_part. \
"Date" -> ack_date_text.
- Continental Quality Heat Treat: often a scanned image; a label/value form \
(Description, Quantity, Promise Date) rather than a table -- no line \
number, no part number, no price; leave line_number, part_number, and \
unit_price null. The quantity is often printed with a unit attached (e.g. \
"500 lbs") -- split it into quantity (500) and unit_of_measure ("lbs"). \
"Date" -> ack_date_text.
- Ostmark Werkzeug (German-language documents): "Pos." -> line_number, \
"Art.-Nr." -> part_number (this may be Beacon's PN or Ostmark's own -- \
copy whichever is printed), "Menge" -> quantity, "EUR / Stück" -> \
unit_price, currency "EUR", "Liefertermin" -> promise_text (e.g. \
"KW 20-22 / 2026"). "Bezeichnung" -> description, unless it says "siehe \
Bestellung" (then null). "Datum / Date" (format DD.MM.YYYY) -> ack_date_text.
- QuickShip Industrial: an informal email, not a table -- no line numbers, \
no description. Lines look like "<part> qty <n> @ $<price> ea ship <date>" \
-- parse into part_number, quantity, unit_price, unit_of_measure "ea", \
currency "$", and promise_text copied from "ship <date>" onward (including \
the word "ship"). The email header's "Date:" -> ack_date_text.

Read scanned/image-only documents visually. Translate non-English text as \
needed to decide what goes where, but keep part numbers, PO numbers, and \
promise_text verbatim as printed.`;

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  return JSON.parse(candidate);
}

export async function extractConfirmation(
  pdfBase64: string,
): Promise<Extraction> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: pdfBase64,
            },
          },
          {
            type: "text",
            text: "Extract this confirmation document as JSON per the schema in your instructions. Return only the JSON object.",
          },
        ],
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
    throw new Error(
      `Model response was not valid JSON: ${textBlock.text.slice(0, 500)}`,
    );
  }

  const result = ExtractionSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Extraction did not match expected schema: ${result.error.message}`,
    );
  }

  return result.data;
}
