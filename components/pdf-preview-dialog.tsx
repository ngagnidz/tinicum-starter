"use client";

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function PdfPreviewDialog({
  name,
  url,
  children,
}: {
  name: string;
  url?: string;
  children: React.ReactNode;
}) {
  if (!url) return <>{children}</>;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="text-blue-600 underline hover:no-underline">
          {children}
        </button>
      </DialogTrigger>
      <DialogContent className="flex flex-col p-0">
        <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-3 pr-10">
          <DialogTitle className="truncate">{name}</DialogTitle>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-xs text-blue-600 hover:underline"
          >
            Open ↗
          </a>
        </div>
        <iframe src={url} title={name} className="h-[80vh] w-full rounded-b-lg" />
      </DialogContent>
    </Dialog>
  );
}
