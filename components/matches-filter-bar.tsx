"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function MatchesFilterBar({
  runId,
  statuses,
  vendors,
  children,
}: {
  runId: string;
  statuses: { value: string; label: string }[];
  vendors: string[];
  children: ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Local state mirrors the URL but updates immediately on input, so controls
  // reflect the user's choice right away instead of snapping back to the old
  // URL value while the navigation is still pending.
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [status, setStatus] = useState(searchParams.get("status") ?? "");
  const [vendor, setVendor] = useState(searchParams.get("vendor") ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep controls in sync if the URL changes from elsewhere (e.g. back/forward).
  useEffect(() => {
    setSearch(searchParams.get("q") ?? "");
    setStatus(searchParams.get("status") ?? "");
    setVendor(searchParams.get("vendor") ?? "");
  }, [searchParams]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function navigate(next: { q?: string; status?: string; vendor?: string }) {
    const merged = { q: search, status, vendor, ...next };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    const qs = params.toString();
    startTransition(() => {
      router.push(`/runs/${runId}/matches${qs ? `?${qs}` : ""}`, { scroll: false });
    });
  }

  function handleSearchChange(value: string) {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => navigate({ q: value }), 250);
  }

  function handleStatusChange(value: string) {
    setStatus(value);
    navigate({ status: value });
  }

  function handleVendorChange(value: string) {
    setVendor(value);
    navigate({ vendor: value });
  }

  function clearFilters() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearch("");
    setStatus("");
    setVendor("");
    startTransition(() => {
      router.push(`/runs/${runId}/matches`, { scroll: false });
    });
  }

  const hasFilters = !!(status || vendor || search);

  return (
    <div className="group flex flex-col gap-4">
      <div
        className="flex flex-wrap items-end gap-3 border-t border-gray-100 pt-4"
        data-pending={isPending ? "" : undefined}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="q" className="text-xs text-gray-500">
            PO number
          </label>
          <input
            id="q"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search PO…"
            className="h-9 w-40 rounded-md border border-gray-300 bg-white px-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="status" className="text-xs text-gray-500">
            Status
          </label>
          <select
            id="status"
            value={status}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm"
          >
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="vendor" className="text-xs text-gray-500">
            Vendor
          </label>
          <select
            id="vendor"
            value={vendor}
            onChange={(e) => handleVendorChange(e.target.value)}
            className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm"
          >
            <option value="">All vendors</option>
            {vendors.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3 ml-auto">
          {isPending && (
            <span className="flex items-center gap-2 text-sm text-gray-500 animate-fadeIn">
              <span className="inline-block w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              Filtering…
            </span>
          )}
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-sm text-blue-600 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      <div className="transition-opacity duration-200 group-has-[[data-pending]]:opacity-40">
        {children}
      </div>
    </div>
  );
}
