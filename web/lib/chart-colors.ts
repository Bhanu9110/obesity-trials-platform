/**
 * Categorical chart colours, fixed order (validated per theme: CVD separation + contrast,
 * 5 slots). The values live in CSS variables (globals.css) so they follow light / dark.
 */
export const SERIES = [1, 2, 3, 4, 5].map((i) => `rgb(var(--series-${i}))`) as readonly string[];
export const CHART_BRAND = "rgb(var(--chart-brand))";
export const CHART_VIOLET = "rgb(var(--chart-violet))";

/** Development phases in pipeline order (for charts and filters). */
export const PHASE_ORDER = ["EARLY_PHASE1", "PHASE1", "PHASE1, PHASE2", "PHASE2", "PHASE2, PHASE3", "PHASE3", "PHASE4", "NA", "NONE"];
export const phaseIndex = (n: string) => { const i = PHASE_ORDER.indexOf(n); return i < 0 ? 99 : i; };
