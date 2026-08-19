# ora-space.opencode

An **agent plugin** for Ora that publishes [OpenCode](https://opencode.ai) as a
selectable agent. The plugin runs `opencode acp` (OpenCode's native
[Agent Client Protocol](https://agentclientprotocol.com) mode) as a child
process and bridges it to Ora as a pure ACP pipe.

Nothing in Ora is hardcoded for this plugin: it is discovered from the installed
plugin directory, validated from `package.json`, and launched as an ordinary
agent provider. Deleting the directory removes the agent.

```
┌────────────────────────── Ora host (Rust) ───────────────────────────┐
│    invoke : agent/start · agent/stop · agent/listModels              │
│    notify : agent/acp (bidirectional, payload never parsed)          │
└────────────────────────────┬─────────────────────────────────────────┘
                             │ stdio, 4-byte length + 0x01 + JSON-RPC
                             v
┌──────────────────── this plugin (Deno process) ──────────────────────┐
│  @ora-space/plugin-sdk/agent   AgentPlugin base, handshake, dispatch │
│  @ora-space/plugin-sdk/acp     AcpProcessBridge, NDJSON re-framing   │
│  src/main.ts · command.ts · models.ts   what is OpenCode-specific    │
└────────────────────────────┬─────────────────────────────────────────┘
                             │ NDJSON, one JSON-RPC object per line
                             v
                       opencode acp (ACP protocolVersion 1)
```

## What lives here

Everything generic — the Ora handshake, the `AgentPlugin` base class, the ACP
child-process bridge, command-candidate resolution, and the host simulator —
comes from the published SDK (`jsr:@ora-space/plugin-sdk`). This package only
contains what is specific to OpenCode:

```
package.json     Ora manifest: id, kind, engines, contributed agent, declared permissions
deno.json        SDK dependency (jsr:@ora-space/plugin-sdk@^1), lock: true, developer tasks
src/main.ts      OpenCodeAgentPlugin extends AgentPlugin; spawns `opencode acp --cwd <cwd>`
src/command.ts   ORA_OPENCODE_BIN pin, platform candidates, not-installed → -32001
src/models.ts    agent/listModels via `opencode models`, cached, curated fallback
tests/           HostSimulator-driven end-to-end check against the real CLI
```

## Contract mapping

| Host requirement                     | Implementation                                                    |
| ------------------------------------ | ----------------------------------------------------------------- |
| `ora/register` with methods + emits  | SDK `runAgentPlugin` → `defineAgent`: 3 methods, `agent/acp` emit |
| `agent/start`                        | `AcpProcessBridge.start` spawns `opencode acp --cwd <cwd>`        |
| `agent/stop`                         | kills the CLI, keeps this process alive so a later start respawns |
| `agent/listModels`                   | `src/models.ts`: `opencode models`, cached, curated fallback      |
| `agent/acp` (both directions)        | `AcpProcessBridge`, payload never parsed                          |
| CLI absent → `-32001`                | `src/command.ts` via SDK `tryEachCandidate`                       |
| one plugin = one agent = one process | a single plugin instance owning a single bridge                   |

## Requirements

- The OpenCode CLI on PATH (`opencode`, or the `opencode.cmd` shim npm installs
  on Windows). Pin an explicit binary with `ORA_OPENCODE_BIN`.
- Deno, which Ora provides for plugin processes.

The manifest declares the permissions this plugin needs (`run`, `read`, `env`
for `ORA_OPENCODE_BIN`/`PATH`/…, `net`); Ora grants exactly those.

## Dependencies and offline use

The SDK is a regular dependency pinned by `deno.lock`. Ora resolves it into its
own dependency cache when the plugin is installed and launches the plugin with
`--cached-only`, so no network is touched at runtime. For fully offline
machines, publish a self-contained package (`"vendor": true` in `deno.json` and
run `deno install --entrypoint src/main.ts` before packing) so the SDK ships
inside the package.

## Verification

`deno task check`, `deno task lint`, and `deno task simulate`. The simulation
launches this plugin the way Ora does, against the real CLI, and asserts the
handshake, `agent/start`, ACP `initialize` and `session/new`,
`agent/listModels`, and `agent/stop`. To run it against an unpublished SDK
checkout, point `ORA_PLUGIN_DENO_CONFIG` (and `deno test --config`) at a config
whose imports map `@ora-space/plugin-sdk/*` to that checkout.

## Known limits

- `agent/start` receives the host's home directory as `cwd`; per-session working
  directories travel in ACP `session/new`, which this plugin passes through.
- The model list is cached for the process lifetime, so models that appear after
  a provider login need a plugin restart.
- When the CLI exits on its own the plugin logs it and lets the host observe a
  stalled connection; the contract has no `agent/exited` notification yet.
