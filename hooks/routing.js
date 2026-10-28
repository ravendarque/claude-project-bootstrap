export const EXECUTOR_SUFFIX = ":bootstrap-executor";
export const EXECUTOR_MODEL = "sonnet";
export const OCCUPYING = ["pending", "running", "waiting", "idle"];
export const DENY_MESSAGE =
  "routing: a bootstrap-executor is already active. Send follow-ups to the existing executor instead of spawning another.";

export function isExecutor(subagentType) {
  return typeof subagentType === "string" && subagentType.endsWith(EXECUTOR_SUFFIX);
}

export function decideSpawn(subagentType, agents, reserved = false) {
  if (!isExecutor(subagentType)) return { action: "pass" };
  const occupied = agents.some((a) => isExecutor(a.type) && OCCUPYING.includes(a.status));
  if (reserved || occupied) return { action: "deny", message: DENY_MESSAGE };
  return { action: "force", model: EXECUTOR_MODEL };
}
