import { EnvVarWarning } from "@/components/env-var-warning";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { UploadForm } from "@/components/upload-form";
import { hasEnvVars } from "@/lib/utils";
import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center">
      <div className="flex-1 w-full flex flex-col gap-12 items-center">
        <nav className="w-full flex justify-center border-b border-b-foreground/10 h-16">
          <div className="w-full max-w-5xl flex justify-between items-center p-3 px-5 text-sm">
            <div className="flex gap-5 items-center font-semibold">
              <Link href={"/"}>PO Confirmation Reconciler</Link>
            </div>
            {!hasEnvVars ? (
              <EnvVarWarning />
            ) : (
              <ThemeSwitcher />
            )}
          </div>
        </nav>
        <div className="flex-1 flex flex-col gap-8 w-full max-w-5xl p-5 items-center">
          <div className="text-center flex flex-col gap-2">
            <h1 className="text-2xl font-semibold">
              Match vendor confirmations to open POs
            </h1>
            <p className="text-muted-foreground text-sm max-w-md">
              Upload the open POs CSV and the vendor confirmation PDFs, run
              extraction, then review the match table.
            </p>
          </div>
          <UploadForm />
        </div>

        <footer className="w-full flex items-center justify-center border-t mx-auto text-center text-xs gap-8 py-16">
          <ThemeSwitcher />
        </footer>
      </div>
    </main>
  );
}
