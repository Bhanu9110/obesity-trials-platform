/** Categorical chart colours for the dark surface (validated: CVD separation + 3:1 contrast, 5 slots, fixed order). */
export const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"] as const;

/** Development phases in pipeline order (for charts and filters). */
export const PHASE_ORDER = ["EARLY_PHASE1", "PHASE1", "PHASE1, PHASE2", "PHASE2", "PHASE2, PHASE3", "PHASE3", "PHASE4", "NA", "NONE"];
export const phaseIndex = (n: string) => { const i = PHASE_ORDER.indexOf(n); return i < 0 ? 99 : i; };
