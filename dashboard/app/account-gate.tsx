"use client";

import { ReactNode } from "react";
import {
  useCurrentAccount,
  useWallets,
  useConnectWallet,
  useDisconnectWallet,
} from "@mysten/dapp-kit";
import { isGoogleWallet } from "@mysten/enoki";

const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;

export function AccountGate({ children }: { children: ReactNode }) {
  const account = useCurrentAccount();
  if (!account) return <SignInScreen />;
  return <>{children}</>;
}

function SignInScreen() {
  const wallets = useWallets();
  const { mutate: connect, isPending } = useConnectWallet();
  const googleWallet = wallets.find(isGoogleWallet);

  const points = [
    "Store private memory for AI agents — encrypted on Walrus, owned by you.",
    "Grant an agent one category, for a set time — scoped, expiring, revocable.",
    "Every access enforced & logged on-chain. Revoke in one click.",
  ];

  return (
    <main className="grid min-h-screen place-items-center px-5 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-500 text-xl font-black text-neutral-950">H</div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-neutral-50">Handoff</h1>
            <p className="text-xs text-neutral-500">OAuth for AI memory</p>
          </div>
        </div>

        <h2 className="text-3xl font-bold leading-tight tracking-tight text-neutral-50">
          Your AI memory,<br /><span className="text-emerald-400">on a leash.</span>
        </h2>
        <p className="mt-3 text-sm text-neutral-400">
          Agents remember everything and never forget. Handoff puts you in control — lend specific,
          expiring, revocable slices of your memory to the agents you choose.
        </p>

        <ul className="mt-6 space-y-2.5">
          {points.map((p, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-neutral-300">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-400">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>
              </span>
              {p}
            </li>
          ))}
        </ul>

        <button
          className="mt-7 inline-flex w-full items-center justify-center gap-3 rounded-xl bg-white px-5 py-3 font-semibold text-neutral-900 transition hover:bg-neutral-200 disabled:opacity-50"
          disabled={!googleWallet || isPending}
          onClick={() => googleWallet && connect({ wallet: googleWallet })}
        >
          <GoogleIcon />
          {isPending ? "Connecting…" : "Sign in with Google"}
        </button>
        {!googleWallet && (
          <p className="mt-3 text-xs text-amber-400">
            Google sign-in unavailable — check NEXT_PUBLIC_ENOKI_API_KEY / NEXT_PUBLIC_GOOGLE_CLIENT_ID.
          </p>
        )}
        <p className="mt-3 text-center text-xs text-neutral-600">No wallet, no seed phrase. You get a Sui identity via zkLogin.</p>
      </div>
    </main>
  );
}

export function AccountChip() {
  const account = useCurrentAccount();
  const { mutate: disconnect } = useDisconnectWallet();
  if (!account) return null;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="rounded-full border border-neutral-800 bg-neutral-900 px-3 py-1 font-mono text-emerald-400">
        {short(account.address)}
      </span>
      <button className="text-neutral-500 hover:text-neutral-300" onClick={() => disconnect()}>
        sign out
      </button>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}
