"use client";

import { ReactNode } from "react";
import { useHandoff } from "./handoff-context";
import { AccountChip } from "./account-gate";

/** Gates the dashboard on a provisioned MemWal account + registered proxy delegate. */
export function ProvisionGate({ children }: { children: ReactNode }) {
  const { status, provision, provisioning, provisionStep, error, refresh } = useHandoff();

  if (status === "ready") return <>{children}</>;

  return (
    <main className="grid min-h-screen place-items-center px-5">
      <div className="absolute right-5 top-5">
        <AccountChip />
      </div>
      <div className="w-full max-w-lg">
        {status === "loading" && (
          <div className="text-center text-neutral-400">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-neutral-700 border-t-emerald-400" />
            Checking your on-chain vault…
          </div>
        )}

        {(status === "needs-setup" || status === "error") && (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-7 text-center">
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-500 text-xl font-black text-neutral-950">
              H
            </div>
            <h1 className="text-2xl font-bold text-neutral-50">Set up your memory vault</h1>
            <p className="mx-auto mt-2 max-w-sm text-sm text-neutral-400">
              Handoff creates your identity and your encrypted memory vault on Sui — the
              on-chain policy that controls who can ever decrypt a memory, and lets you
              <span className="text-red-400"> provably shred</span> any of it.
              A few quick on-chain steps — <span className="text-emerald-400">gas is on us</span>.
            </p>

            <ol className="mx-auto mt-5 max-w-xs space-y-2 text-left text-sm text-neutral-300">
              <li className="flex items-center gap-2">
                <Dot /> Create your identity + authorize this device
              </li>
              <li className="flex items-center gap-2">
                <Dot /> Create your encrypted memory vault (the Seal policy)
              </li>
              <li className="flex items-center gap-2">
                <Dot /> Authorize the Handoff gateway (revocable anytime)
              </li>
            </ol>

            {provisionStep && (
              <p className="mt-5 flex items-center justify-center gap-2 text-sm text-emerald-300">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-800 border-t-emerald-300" />
                {provisionStep}
              </p>
            )}

            {error && !provisioning && (
              <p className="mt-4 break-words rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                {error}
              </p>
            )}

            <button
              className="mt-6 w-full rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-neutral-950 hover:bg-emerald-400 disabled:opacity-50"
              onClick={() => provision()}
              disabled={provisioning}
            >
              {provisioning ? "Setting up…" : error ? "Retry setup" : "Set up my vault"}
            </button>

            {status === "error" && !provisioning && (
              <button className="mt-3 text-xs text-neutral-500 hover:text-neutral-300" onClick={() => refresh()}>
                re-check
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function Dot() {
  return <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />;
}
