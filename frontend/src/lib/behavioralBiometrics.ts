export type RiskLevel = "low" | "medium" | "high";

export interface BehavioralAnalytics {
  riskScore: number;
  riskLevel: RiskLevel;
  events: number;
  updatedAt: number;
}

type Snapshot = {
  riskScore: number;
  riskLevel: RiskLevel;
};

type Listener = (snapshot: Snapshot) => void;

const listeners = new Set<Listener>();

export const behavioralBiometrics = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getAnalytics(): BehavioralAnalytics {
    return { riskScore: 0, riskLevel: "low", events: 0, updatedAt: Date.now() };
  },
  resetRisk(): void {
    for (const listener of listeners) {
      listener({ riskScore: 0, riskLevel: "low" });
    }
  },
};

export default behavioralBiometrics;
