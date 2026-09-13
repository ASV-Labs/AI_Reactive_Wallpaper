# AI Reactive Wallpaper (Hermes Neon H)

**Public repo:** [ASV-Labs/AI_Reactive_Wallpaper](https://github.com/ASV-Labs/AI_Reactive_Wallpaper)  
**Runtime plugin id:** `hermes-neon-h` (folder name must match)  
**Org:** [ASV Labs](https://github.com/ASV-Labs) (Charles Bonetti / A Salty Vet)  
**Type:** Hermes Desktop **disk plugin** (not OS wallpaper, not a Hermes core fork)

Animated neon **H** mark that reacts to AI **provider** health (OpenAI, Anthropic/Claude, Google, xAI) plus local Hermes turn-busy. Opt-in (`defaultEnabled: false`).

Listed on the ASV Labs public index: [asv-labs.github.io](https://asv-labs.github.io).

Inspiration: Erik Johansson’s Omarchy reactive wallpaper — shipped here as a Hermes Desktop plugin pane, not an OS wallpaper daemon.

## Enable

1. Install the plugin folder (below).
2. Hermes Desktop → **Capabilities → Plugins** → enable **hermes-neon-h** (opt-in).
3. Optional: ⌘K → **Open Neon H** / **Open Neon H settings**, or use the status-bar chips.

## Install

```bash
export HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
mkdir -p "$HERMES_HOME/desktop-plugins/hermes-neon-h"
curl -fsSL https://raw.githubusercontent.com/ASV-Labs/AI_Reactive_Wallpaper/main/plugin.js \
  -o "$HERMES_HOME/desktop-plugins/hermes-neon-h/plugin.js"
curl -fsSL https://raw.githubusercontent.com/ASV-Labs/AI_Reactive_Wallpaper/main/assets/logo.png \
  -o "$HERMES_HOME/desktop-plugins/hermes-neon-h/logo.png"
```

Or clone and copy:

```bash
git clone https://github.com/ASV-Labs/AI_Reactive_Wallpaper.git
mkdir -p "${HERMES_HOME:-$HOME/.hermes}/desktop-plugins/hermes-neon-h"
cp AI_Reactive_Wallpaper/plugin.js AI_Reactive_Wallpaper/assets/logo.png \
  "${HERMES_HOME:-$HOME/.hermes}/desktop-plugins/hermes-neon-h/"
```

Folder name **must** equal plugin id: `hermes-neon-h`.

Then in Hermes Desktop: **⌘K → Reload desktop plugins**.

Only `plugin.js` is required at runtime (logo is embedded as a data URL). Keeping `logo.png` beside it is recommended for reveal-in-folder / redistribution.

## What you get (v1)

| Surface | Behavior |
|--------|----------|
| Pane **Neon H** | Canvas on black; animated H tinted by active provider + health |
| Pane **Neon H settings** | Colors (hex), animation mode, watched providers, placement |
| Status bar (right) | Chips for OpenAI / Anthropic / Google / xAI |
| Palette | Open Neon H · Open Neon H settings |
| Optional | `host.openWorkspace` when available; otherwise pane fallback |

### Animation modes

`breathe` · `static` · `pulse-on-busy` · `outage-flash`

### Visual mapping

- **operational** — calm breathe in provider color  
- **degraded** — amber / warn pulse  
- **major** — red flash  
- **`host.state.busy`** — intensifies pulse mid-turn  

Default provider colors: OpenAI `#10a37f`, Anthropic `#d4a27f`, Google `#4285f4`, xAI `#ff6b2c`.

### Status sources (CORS-friendly where possible)

| Provider | Endpoint | Notes |
|----------|----------|--------|
| OpenAI | `https://status.openai.com/api/v2/summary.json` | Statuspage indicator |
| Anthropic | `https://status.claude.com/api/v2/summary.json` | Claude status (Anthropic redirects here) |
| Google | `https://status.cloud.google.com/incidents.json` | **GCP status proxy** — not a dedicated Gemini consumer page |
| xAI | `https://status.x.ai/api/v2/summary.json` then HTML sniff | May stay **unknown** if both fail — we do not invent “operational” |

Poll interval ~50s (polite). Active provider is inferred from `host.state.model` / `host.state.profile` hints.

Settings persist via `ctx.storage` (plugin-scoped).

## What works / blockers (v1)

**Works**

- Disk ESM plugin with only allowed imports (`@hermes/plugin-sdk`, `react`, `react/jsx-runtime`)
- Canvas pane + ResizeObserver sizing
- Status-bar chips + settings + palette
- Provider-tinted neon (intentional product colors on canvas; UI chrome uses theme vars)

**Blockers / honesty**

- **No wallpaper API** — this is a desktop plugin pane, not Omarchy/OS wallpaper
- **CORS** — some status endpoints or HTML fallbacks may fail in-renderer; unknown ≠ operational
- **Google = GCP proxy** — open cloud incidents, not Gemini-only consumer status
- **xAI** — JSON may 404/CORS; HTML sniff is best-effort; else `unknown`
- **SegmentedControl / StatusDot** — used when present in the SDK; plain controls otherwise

## Out of scope

- Omarchy / OS wallpaper hacks  
- Forking Hermes core for chat wallpaper  
- Social posts / marketing automation  
- Secrets, `.env`, or machine-private paths  

## Repo layout

```
AI_Reactive_Wallpaper/
├── plugin.js           # disk plugin (runtime id: hermes-neon-h)
├── assets/
│   └── logo.png        # ASV / Charles neon H mark
├── README.md
├── LICENSE             # MIT
├── package.json
└── .gitignore
```

## License

MIT — see [LICENSE](./LICENSE). Logo: ASV Labs / Charles Bonetti. Hermes SDK and provider status endpoints remain with their respective owners.
