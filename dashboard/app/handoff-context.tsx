"use client";

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { useCurrentAccount, useSuiClient, useSignTransaction } from "@mysten/dapp-kit";
import {
  getAccountIdForOwner,
  getAccountInfo,
  getVaultForOwner,
  getVaultInfo,
  buildCreateAccountTx,
  buildAddDelegatesTx,
  buildCreateVaultTx,
  buildAddVaultDelegateTx,
  accountIdFromTxResult,
  type AccountInfo,
  type DelegateSpec,
} from "@/lib/chain";
import { PROXY_DELEGATE } from "@/lib/config";
import { sponsorSignExecute } from "@/lib/sponsor-client";
import { getOrCreateDeviceKey } from "@/lib/device-key";

type Status = "loading" | "needs-setup" | "ready" | "error";

type Ctx = {
  status: Status;
  address: string | null;
  accountId: string | null;
  accountInfo: AccountInfo | null;
  vaultId: string | null;
  provisioning: boolean;
  provisionStep: string | null;
  error: string | null;
  provision: () => Promise<void>;
  refresh: () => Promise<void>;
};

const HandoffCtx = createContext<Ctx | null>(null);

export function useHandoff(): Ctx {
  const ctx = useContext(HandoffCtx);
  if (!ctx) throw new Error("useHandoff must be used within HandoffProvider");
  return ctx;
}

export function HandoffProvider({ children }: { children: ReactNode }) {
  const account = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutateAsync: signTransaction } = useSignTransaction();

  const address = account?.address ?? null;
  const [status, setStatus] = useState<Status>("loading");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null);
  const [vaultId, setVaultId] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionStep, setProvisionStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Ready = identity account has this browser's device key, AND the user's
   * Vault (the on-chain Seal policy) exists with the gateway authorized as a
   * decryption delegate.
   */
  const isReady = useCallback(
    async (info: AccountInfo | null, vid: string | null): Promise<boolean> => {
      if (!address || !info || !vid) return false;
      const [dk, vault] = await Promise.all([getOrCreateDeviceKey(address), getVaultInfo(suiClient, vid)]);
      if (!vault || vault.wipedAll) return Boolean(vault && !vault.wipedAll); // wiped vault → can't be ready
      return info.delegateAddresses.includes(dk.suiAddress) && vault.delegates.includes(PROXY_DELEGATE.address);
    },
    [address, suiClient],
  );

  const refresh = useCallback(async () => {
    if (!address) return;
    setError(null);
    try {
      const [id, vid] = await Promise.all([
        getAccountIdForOwner(suiClient, address),
        getVaultForOwner(suiClient, address),
      ]);
      setVaultId(vid);
      if (!id) {
        setAccountId(null);
        setAccountInfo(null);
        setStatus("needs-setup");
        return;
      }
      const info = await getAccountInfo(suiClient, id);
      setAccountId(id);
      setAccountInfo(info);
      const ready = await isReady(info, vid);
      setStatus(ready ? "ready" : "needs-setup");
    } catch (e: any) {
      setError(String(e?.message || e));
      setStatus("error");
    }
  }, [address, suiClient, isReady]);

  useEffect(() => {
    if (!address) {
      setStatus("loading");
      return;
    }
    setStatus("loading");
    refresh();
  }, [address, refresh]);

  const provision = useCallback(async () => {
    if (!address) return;
    setProvisioning(true);
    setError(null);
    try {
      // 1) identity account (device-key registry + grant identity)
      let id = accountId ?? (await getAccountIdForOwner(suiClient, address));
      if (!id) {
        setProvisionStep("Creating your identity on Sui…");
        const { tx, targets } = buildCreateAccountTx();
        const res = await sponsorSignExecute({ tx, suiClient, signTransaction, sender: address, targets });
        id = accountIdFromTxResult(res);
        if (!id) throw new Error("account created but id not found in tx result");
        setAccountId(id);
      }

      // 2) register this browser's device key (authenticates your memory ops)
      const info = await getAccountInfo(suiClient, id);
      const dk = await getOrCreateDeviceKey(address);
      if (!info?.delegateAddresses.includes(dk.suiAddress)) {
        setProvisionStep("Authorizing this device…");
        const missing: DelegateSpec[] = [
          { pubBytes: dk.pubBytes, address: dk.suiAddress, label: "handoff-device" },
        ];
        const { tx, targets } = buildAddDelegatesTx(id, missing);
        await sponsorSignExecute({ tx, suiClient, signTransaction, sender: address, targets });
      }

      // 3) memory vault — the on-chain Seal policy your memories are encrypted under
      let vid = vaultId ?? (await getVaultForOwner(suiClient, address));
      if (!vid) {
        setProvisionStep("Creating your encrypted memory vault…");
        const { tx, targets } = buildCreateVaultTx();
        await sponsorSignExecute({ tx, suiClient, signTransaction, sender: address, targets });
        for (let i = 0; i < 8 && !vid; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          vid = await getVaultForOwner(suiClient, address);
        }
        if (!vid) throw new Error("vault created but not yet indexed — retry in a moment");
        setVaultId(vid);
      }

      // 4) authorize the gateway to decrypt on your behalf (you can revoke it)
      const vault = await getVaultInfo(suiClient, vid);
      if (vault && !vault.delegates.includes(PROXY_DELEGATE.address)) {
        setProvisionStep("Authorizing the Handoff gateway…");
        const { tx, targets } = buildAddVaultDelegateTx(vid, PROXY_DELEGATE.address);
        await sponsorSignExecute({ tx, suiClient, signTransaction, sender: address, targets });
      }

      setProvisionStep(null);
      await refresh();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setProvisioning(false);
      setProvisionStep(null);
    }
  }, [address, accountId, vaultId, suiClient, signTransaction, refresh]);

  return (
    <HandoffCtx.Provider
      value={{ status, address, accountId, accountInfo, vaultId, provisioning, provisionStep, error, provision, refresh }}
    >
      {children}
    </HandoffCtx.Provider>
  );
}
