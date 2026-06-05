"use client";

import { ReactNode, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  SuiClientProvider,
  WalletProvider,
  createNetworkConfig,
  useSuiClientContext,
} from "@mysten/dapp-kit";
import { getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { isEnokiNetwork, registerEnokiWallets } from "@mysten/enoki";
import "@mysten/dapp-kit/dist/index.css";

const { networkConfig } = createNetworkConfig({
  testnet: { url: getJsonRpcFullnodeUrl("testnet"), network: "testnet" },
});
const queryClient = new QueryClient();

/** Registers the "Sign in with Google" Enoki wallet once the Sui client exists. */
function RegisterEnokiWallets() {
  const { client, network } = useSuiClientContext();
  useEffect(() => {
    if (!isEnokiNetwork(network)) return;
    const apiKey = process.env.NEXT_PUBLIC_ENOKI_API_KEY;
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!apiKey || !clientId) return;
    const { unregister } = registerEnokiWallets({
      apiKey,
      providers: {
        google: {
          clientId,
          redirectUrl: typeof window !== "undefined" ? `${window.location.origin}/auth` : undefined,
        },
      },
      client: client as never,
      network,
    });
    return unregister;
  }, [client, network]);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork="testnet">
        <RegisterEnokiWallets />
        <WalletProvider autoConnect>{children}</WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}
