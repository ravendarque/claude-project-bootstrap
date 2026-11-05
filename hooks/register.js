import { decideSpawn } from "./routing.js";

let reserved = false;

export const register = (on) => {
  on("agent.spawn", async ($, e, next) => {
    const early = decideSpawn(e.fork === true, [], reserved);
    if (early.action === "deny") return { deny: early.message };
    reserved = true;
    try {
      const decision = decideSpawn(e.fork === true, await $.agent.list());
      if (decision.action === "deny") return { deny: decision.message };
      if (decision.action === "force") return await next({ ...e, model: decision.model });
      return await next(e);
    } finally {
      reserved = false;
    }
  }).catch(($, e, next) => next(e));
};
