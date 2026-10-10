// Globales que la page de vel.gg (play.js, engine.js), la colle du moteur et nos modules partagent.
export {};

type KbnetStats = {
  sent: number; received: number; dropped: number; command: (text: string) => void;
  label?: string; linked?: boolean; relayed?: boolean; relayAsked?: boolean; hostLeft?: boolean; signalFailed?: boolean;
};

declare global {
  var kbnet: KbnetStats | undefined;
  var WorkerGlobalScope: unknown;
  // État de play.js (window.five) : seuls les champs lus par nos modules, le reste reste à vel.gg jusqu'à l'étape 5.
  var five: Record<string, any> | undefined;
  var __perfOverlay: { box: HTMLElement; update: () => void; setMode: (mode: string) => void; readonly mode: string; stop: () => void } | undefined;
  var __perfStats: unknown;
  var __kisakLandingPick: boolean | undefined;
}
