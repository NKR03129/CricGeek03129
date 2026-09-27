# Ollama via Cloudflare Tunnel

This guide exposes a local Ollama instance on macOS through Cloudflare Tunnel without exposing Ollama directly to the public internet.

Traffic flow:

1. Browser -> Vercel app
2. Vercel server route -> `https://ollama-api.<MY_DOMAIN>`
3. Cloudflare Tunnel -> local auth proxy on port `5050`
4. Local auth proxy -> local Ollama on `127.0.0.1:11434`

## Files in this repo

- `ollama-proxy/package.json`
- `ollama-proxy/server.js`
- `ollama-proxy/.env.example`
- `src/app/api/llm/route.ts`
- `cloudflare/config.yml.example`
- `launchd/com.<MY_DOMAIN>.ollama-proxy.plist`
- `launchd/com.<MY_DOMAIN>.cloudflared.plist`

## Verify local Ollama

```bash
ollama list

curl http://127.0.0.1:11434/api/tags

curl http://127.0.0.1:11434/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3.5:latest",
    "prompt": "Say hello from my Mac",
    "stream": false
  }'
```

## Run the local proxy

```bash
cd ollama-proxy
npm install
cp .env.example .env
# edit .env and replace <MY_SHARED_SECRET>
npm start
```

## Install and configure cloudflared on macOS

```bash
brew install cloudflared
cloudflared --version

cloudflared tunnel login
cloudflared tunnel create ollama-prod
cloudflared tunnel list
```

After `cloudflared tunnel create ollama-prod`, note the generated tunnel UUID and the credentials file path in `~/.cloudflared/`.

Create `~/.cloudflared/config.yml` from the example in this repo and replace the placeholders:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /Users/<MY_USERNAME>/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: ollama-api.<MY_DOMAIN>
    service: http://localhost:5050
  - service: http_status:404
```

Validate and create the DNS route:

```bash
cloudflared tunnel ingress validate
cloudflared tunnel route dns ollama-prod ollama-api.<MY_DOMAIN>
cloudflared tunnel run ollama-prod
```

## Vercel environment variables

```env
OLLAMA_URL=https://ollama-api.<MY_DOMAIN>
OLLAMA_MODEL=qwen3.5:latest
OLLAMA_BQS_MODEL=qwen3.5:latest
OLLAMA_MATCH_MODEL=qwen3.5:latest
OLLAMA_SHARED_SECRET=<MY_SHARED_SECRET>
```

## Example frontend call

```ts
const response = await fetch("/api/llm", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    messages: [
      { role: "system", content: "You are a concise cricket assistant." },
      { role: "user", content: "Preview tonight's IPL match in 3 bullet points." },
    ],
  }),
});

const data = await response.json();
```

## Verification order

### Local Ollama

```bash
curl http://127.0.0.1:11434/api/tags
```

### Local proxy

```bash
curl http://127.0.0.1:5050/api/tags \
  -H "Authorization: Bearer <MY_SHARED_SECRET>"
```

### Public tunnel

```bash
curl https://ollama-api.<MY_DOMAIN>/api/tags \
  -H "Authorization: Bearer <MY_SHARED_SECRET>"
```

### Public generate test

```bash
curl https://ollama-api.<MY_DOMAIN>/api/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <MY_SHARED_SECRET>" \
  -d '{
    "model": "qwen3.5:latest",
    "prompt": "Say hello from tunnel",
    "stream": false
  }'
```

## launchd

Copy the sample plist files from `launchd/` into `~/Library/LaunchAgents/`, replace placeholders, then load them:

```bash
mkdir -p ~/Library/LaunchAgents

cp launchd/com.<MY_DOMAIN>.ollama-proxy.plist ~/Library/LaunchAgents/
cp launchd/com.<MY_DOMAIN>.cloudflared.plist ~/Library/LaunchAgents/

launchctl unload ~/Library/LaunchAgents/com.<MY_DOMAIN>.ollama-proxy.plist 2>/dev/null || true
launchctl unload ~/Library/LaunchAgents/com.<MY_DOMAIN>.cloudflared.plist 2>/dev/null || true

launchctl load ~/Library/LaunchAgents/com.<MY_DOMAIN>.ollama-proxy.plist
launchctl load ~/Library/LaunchAgents/com.<MY_DOMAIN>.cloudflared.plist
```

To stop them:

```bash
launchctl unload ~/Library/LaunchAgents/com.<MY_DOMAIN>.ollama-proxy.plist
launchctl unload ~/Library/LaunchAgents/com.<MY_DOMAIN>.cloudflared.plist
```
