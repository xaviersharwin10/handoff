"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCurrentAccount } from "@mysten/dapp-kit";

/** Google redirects back here; the Enoki wallet completes the connection, then we go home. */
export default function AuthCallback() {
  const account = useCurrentAccount();
  const router = useRouter();

  useEffect(() => {
    if (account) router.replace("/");
  }, [account, router]);

  return (
    <main className="grid min-h-screen place-items-center text-neutral-400">
      <div className="text-center">
        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-neutral-700 border-t-emerald-400" />
        Signing you in…
      </div>
    </main>
  );
}
