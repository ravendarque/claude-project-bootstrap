import { decideSpawn } from "./routing.js";

let reserved = false;

export const register = (on) => {
  on("agent.spawn", async ($, e, next) => {
    const early = decideSpawn(e.subagentType, [], reserved);
    if (early.action === "pass") return next(e);
    if (early.action === "deny") return { deny: early.message };
    reserved = true;
    try {
      const decision = decideSpawn(e.subagentType, await $.agent.list());
      if (decision.action === "deny") return { deny: decision.message };
      return await next({ ...e, model: decision.model });
    } finally {
      reserved = false;
    }
  }).catch(($, e, next) => next(e));
};
