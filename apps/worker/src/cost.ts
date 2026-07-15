import type { AgentUsage } from "./agent";

// Accumulates cost across every agent attempt, including failed ones, so
// runs.cost_usd reflects what the run actually spent.
export class CostTracker {
  total = 0;
  usage: Partial<Record<string, AgentUsage>> = {};

  add(label: string, costUsd: number, usage?: AgentUsage) {
    this.total += costUsd;
    if (usage) this.usage[label] = usage;
  }

  addFromError(label: string, err: unknown) {
    const cost = (err as { costUsd?: number })?.costUsd;
    if (typeof cost === "number") this.total += cost;
    const usage = (err as { usage?: AgentUsage })?.usage;
    if (usage) this.usage[label] = usage;
  }
}
