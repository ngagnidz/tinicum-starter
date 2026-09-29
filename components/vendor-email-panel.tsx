"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";

type EmailState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; subject: string; body: string; fallback?: boolean };

export function VendorEmailPanel({ runId, po }: { runId: string; po: string }) {
  const [state, setState] = useState<EmailState>({ status: "loading" });
  const [copied, setCopied] = useState<"subject" | "body" | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    fetch("/api/vendor-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId, po }),
    })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (!json.ok) {
          setState({ status: "error", error: json.error ?? "Could not draft email" });
          return;
        }
        setState({
          status: "ready",
          subject: json.subject,
          body: json.body,
          fallback: json.fallback,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          status: "error",
          error: err instanceof Error ? err.message : "Could not draft email",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [runId, po]);

  async function copy(text: string, which: "subject" | "body") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) -- nothing to do.
    }
  }

  return (
    <Card className="shadow-sm">
      <CardContent className="pt-6 flex flex-col gap-3">
        <h2 className="font-semibold text-gray-900">Email vendor</h2>

        {state.status === "loading" && (
          <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
            <span className="inline-block w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            Drafting an email…
          </div>
        )}

        {state.status === "error" && <p className="text-sm text-red-600">{state.error}</p>}

        {state.status === "ready" && (
          <div className="flex flex-col gap-3">
            {state.fallback && (
              <p className="text-xs text-gray-400">
                AI draft unavailable — used a plain template instead.
              </p>
            )}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <label className="text-xs text-gray-500">Subject</label>
                <button
                  type="button"
                  onClick={() => copy(state.subject, "subject")}
                  className="text-xs text-blue-600 hover:underline"
                >
                  {copied === "subject" ? "Copied" : "Copy"}
                </button>
              </div>
              <input
                readOnly
                value={state.subject}
                className="h-9 rounded-md border border-gray-300 bg-gray-50 px-2 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <label className="text-xs text-gray-500">Body</label>
                <button
                  type="button"
                  onClick={() => copy(state.body, "body")}
                  className="text-xs text-blue-600 hover:underline"
                >
                  {copied === "body" ? "Copied" : "Copy"}
                </button>
              </div>
              <textarea
                readOnly
                value={state.body}
                rows={12}
                className="rounded-md border border-gray-300 bg-gray-50 p-2 text-sm font-sans"
              />
            </div>
            <a
              href={`mailto:?subject=${encodeURIComponent(state.subject)}&body=${encodeURIComponent(state.body)}`}
              className="text-sm text-blue-600 hover:underline"
            >
              Open in email app →
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
