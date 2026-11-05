export const EXECUTOR_SUFFIX = ":bootstrap-executor";
export const EXECUTOR_MODEL = "sonnet";
export const OCCUPYING = ["pending", "running", "waiting", "idle"];
export const DENY_MESSAGE =
  "routing: only one subagent may run at a time, to protect the user's subscription token limits. " +
  "Wait for the running subagent to finish, or send it follow-ups instead of spawning another. " +
  "This limit applies in every project, including tools that fan out subagents on purpose.";

export function isExecutor(subagentType) {
  return typeof subagentType === "string" && subagentType.endsWith(EXECUTOR_SUFFIX);
}

export function decideSpawn(subagentType, agents, reserved = false) {
  const occupied = agents.some((a) => OCCUPYING.includes(a.status));
  if (reserved || occupied) return { action: "deny", message: DENY_MESSAGE };
  if (isExecutor(subagentType)) return { action: "force", model: EXECUTOR_MODEL };
  return { action: "pass" };
}
