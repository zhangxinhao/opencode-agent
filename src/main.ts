import { AcpProcessBridge, spawnPipedProcess } from "@ora-space/plugin-sdk/acp";
import {
  type AcpSender,
  type AgentModel,
  AgentPlugin,
  type AgentStartContext,
  type PluginContext,
  runAgentPlugin,
} from "@ora-space/plugin-sdk/agent";
import type { JsonValue } from "@ora-space/plugin-sdk";
import { tryOpenCode } from "./command.ts";
import { listOpenCodeModels } from "./models.ts";

/** Must match `ora.id` in package.json, which is also this agent's identity inside Ora. */
const PLUGIN_ID = "ora-space.opencode";

/**
 * Publishes OpenCode as an Ora agent.
 *
 * One plugin process is one agent, so this class owns exactly one `opencode acp` child and needs
 * no addressing of its own. Everything generic — the Ora handshake, the ACP re-framing, the child
 * process lifetime — lives in the SDK; this file only says how OpenCode is launched and how its
 * models are listed.
 */
class OpenCodeAgentPlugin extends AgentPlugin {
  /** Valid only between `agent/start` and the end of the process; frames before that are lost. */
  #send: AcpSender | undefined;

  readonly #bridge = new AcpProcessBridge({
    // OpenCode exposes ACP as a subcommand and takes its initial directory as a flag; the spawn
    // cwd is set to the same directory so relative paths inside the CLI agree with it.
    spawn: (cwd) =>
      tryOpenCode((command) =>
        spawnPipedProcess(command, ["acp", "--cwd", cwd], cwd)
      ),
    onAcpFrame: (frame) => {
      // A send failure means the host connection is already gone; there is nothing this plugin
      // can do with the frame, and throwing here would only kill the stdout pump.
      void this.#send?.(frame).catch((error) => {
        console.warn(`failed to forward ACP frame to the host: ${error}`);
      });
    },
    onExited: () => {
      console.warn(
        "the OpenCode CLI exited on its own; Ora decides whether to reconnect",
      );
    },
    logTag: "opencode",
  });

  override onActivate(context: PluginContext): void {
    console.info(`${context.pluginId} activated`);
  }

  override async onStart(
    context: AgentStartContext,
    send: AcpSender,
  ): Promise<void> {
    this.#send = send;
    await this.#bridge.start(context.cwd);
  }

  override onStop(): Promise<void> {
    return this.#bridge.stop();
  }

  override onListModels(): Promise<AgentModel[]> {
    return listOpenCodeModels();
  }

  override onAcp(frame: JsonValue): Promise<void> | void {
    return this.#bridge.forwardAcp(frame);
  }

  override async onDeactivate(): Promise<void> {
    await this.#bridge.stop();
  }
}

await runAgentPlugin(new OpenCodeAgentPlugin(), { pluginId: PLUGIN_ID });
