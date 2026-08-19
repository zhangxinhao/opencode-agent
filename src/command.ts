import {
  platformCommandCandidates,
  readEnv,
  tryEachCandidate,
} from "@ora-space/plugin-sdk/acp";

/** The OpenCode CLI binary name as npm, scoop, and choco install it. */
const BINARY_NAME = "opencode";

/**
 * Lists the commands that can launch the OpenCode CLI, in priority order.
 *
 * `ORA_OPENCODE_BIN` pins an explicit binary path, which matters on Windows where npm only
 * exposes a `.cmd` shim on PATH. Without a pin, Windows gets both spellings because npm installs
 * only `opencode.cmd` while scoop and choco expose `opencode.exe`.
 */
export function resolveOpenCodeCandidates(): string[] {
  const explicit = readEnv("ORA_OPENCODE_BIN")?.trim();
  if (explicit !== undefined && explicit !== "") {
    return [explicit];
  }
  return platformCommandCandidates(BINARY_NAME);
}

/** Runs `attempt` against each OpenCode candidate, mapping an absent CLI to `-32001`. */
export function tryOpenCode<T>(
  attempt: (command: string) => T | Promise<T>,
): Promise<T> {
  return tryEachCandidate(
    resolveOpenCodeCandidates(),
    attempt,
    (tried) =>
      `OpenCode is not installed or not on PATH (tried: ${
        tried.join(", ")
      }); install it from https://opencode.ai/docs/ or set ORA_OPENCODE_BIN`,
  );
}
