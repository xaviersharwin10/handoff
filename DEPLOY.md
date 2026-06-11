# Deploying Handoff (public link)

Two pieces, ~20 minutes total. Both have free tiers; no card needed.

| Piece | Host | Why |
|---|---|---|
| `proxy/` — the gateway | **Render** (free web service) | long-running Node process (embedder model stays warm, in-memory index) |
| `dashboard/` — owner app + agent app | **Vercel** (free) | Next.js, serverless |

> ⚠️ **Before anything public: rotate the Groq key** (the old one was shared in chat).
> console.groq.com → API Keys → revoke + create new.

---

## 1. Gateway → Render

1. Push the repo to GitHub (if not already).
2. [dashboard.render.com](https://dashboard.render.com) → **New → Blueprint** → select the repo.
   Render reads [render.yaml](render.yaml) and creates the `handoff-gateway` service.
3. Fill in the secret env vars when prompted:
   - `PROXY_DELEGATE_KEY` — same value as local `proxy/.env`
   - `HANDOFF_MASTER_SECRET` — same value as local `proxy/.env`
   - `GATEWAY_ALLOWED_ORIGINS` — your Vercel URL (add it after step 2; e.g. `https://handoff-xyz.vercel.app`)
   - `LLM_API_KEY` — the **new** Groq key
4. Deploy. First boot downloads the ~25 MB embedding model — wait for `/health` to go green.
5. Note the service URL, e.g. `https://handoff-gateway.onrender.com`.

**Free-tier caveat:** Render free spins down after ~15 min idle; the next request takes
~60–90 s to cold-start. For demo days, ping `/health` every 10 min with a free
[UptimeRobot](https://uptimerobot.com) monitor to keep it warm.

## 2. Dashboard → Vercel

1. [vercel.com/new](https://vercel.com/new) → import the repo → set **Root Directory = `dashboard`**
   (framework auto-detected: Next.js).
2. Environment variables (copy values from local `dashboard/.env.local`, except the URLs):

   | Var | Value |
   |---|---|
   | `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | same as local |
   | `NEXT_PUBLIC_ENOKI_API_KEY` | same as local |
   | `ENOKI_SECRET_KEY` | same as local |
   | `PROXY_DELEGATE_KEY` | same as local |
   | `HANDOFF_MASTER_SECRET` | same as local (must equal the gateway's) |
   | `PROXY_URL` | the Render URL |
   | `NEXT_PUBLIC_GATEWAY_URL` | the Render URL |
   | `LLM_API_KEY` | the **new** Groq key |
   | `LLM_BASE_URL` | `https://api.groq.com/openai/v1` |
   | `LLM_MODEL` | `llama-3.3-70b-versatile` |

3. Deploy → note the URL, e.g. `https://handoff-xyz.vercel.app`.

## 3. Wire the three external allowlists

1. **Render:** set `GATEWAY_ALLOWED_ORIGINS` = the Vercel URL (no trailing slash) → redeploy.
2. **Google Cloud console** → your OAuth client → **Authorized JavaScript origins**: add the
   Vercel URL. **Authorized redirect URIs**: add `https://<vercel-url>/auth`.
3. **Enoki portal** (portal.enoki.mystenlabs.com) → your app → allowed origins: add the Vercel URL.

## 4. Smoke-test the live link

- Open the Vercel URL in a fresh browser profile → sign in with Google → vault provisions
  (3 sponsored steps) → add a memory → assemble the handoff team → Researcher saves a
  finding → Writer continues → revoke → Forget a memory → deletion proof opens on suivision.
- `curl https://<render-url>/health` → `{"ok":true}`.

That's it — the link is shareable. Anyone with a Google account can use it end-to-end;
gas is sponsored, the LLM and embeddings are free-tier, storage is Walrus testnet.
