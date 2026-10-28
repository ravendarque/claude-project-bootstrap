import { decideSpawn } from "./routing.js";

export const register = (on) => {
  on("agent.spawn", async ($, e, next) => {
    const decision = decideSpawn(e.subagentType, await $.agent.list());
    if (decision.action === "deny") return { deny: decision.message };
    if (decision.action === "force") return next({ ...e, model: decision.model });
    return next(e);
  }).catch(($, e, next) => next(e));
};
