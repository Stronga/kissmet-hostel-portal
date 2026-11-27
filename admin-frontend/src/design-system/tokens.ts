/** Confirmed Kissmet brand colours (D6). Do not recolour the logo from these. */
export const brandColors = {
  green: "#064B36",
  dark: "#142526",
  gold: "#B9A17A",
  orange: "#F58220",
  red: "#CE071B",
  background: "#F5F7F6"
} as const;

export interface ContrastPair {
  id: string;
  foreground: string;
  background: string;
  /** Minimum WCAG ratio required for this usage. */
  minRatio: number;
  usage: string;
}

/**
 * Pairs the UI is allowed to use. Each minRatio is the WCAG AA bar for that usage
 * (4.5 for normal text, 3 for large text and non-text UI).
 */
export const approvedContrastPairs: ContrastPair[] = [
  { id: "primary-text-on-white", foreground: "#064B36", background: "#FFFFFF", minRatio: 4.5, usage: "Primary text and primary buttons' inverse is white; this is the green as text" },
  { id: "white-on-primary", foreground: "#FFFFFF", background: "#064B36", minRatio: 4.5, usage: "Label on primary button" },
  { id: "white-on-primary-hover", foreground: "#FFFFFF", background: "#043828", minRatio: 4.5, usage: "Label on primary hover" },
  { id: "primary-on-background", foreground: "#064B36", background: "#F5F7F6", minRatio: 4.5, usage: "Primary text on page background" },
  { id: "dark-on-white", foreground: "#142526", background: "#FFFFFF", minRatio: 4.5, usage: "Body text" },
  { id: "dark-on-background", foreground: "#142526", background: "#F5F7F6", minRatio: 4.5, usage: "Body text on page background" },
  { id: "secondary-on-white", foreground: "#3E524C", background: "#FFFFFF", minRatio: 4.5, usage: "Secondary text" },
  { id: "secondary-on-background", foreground: "#3E524C", background: "#F5F7F6", minRatio: 4.5, usage: "Secondary text on page background" },
  { id: "secondary-on-muted", foreground: "#3E524C", background: "#E7EEEB", minRatio: 4.5, usage: "Secondary text on muted surface" },
  { id: "white-on-danger", foreground: "#FFFFFF", background: "#CE071B", minRatio: 4.5, usage: "Label on danger button" },
  { id: "white-on-danger-hover", foreground: "#FFFFFF", background: "#A30616", minRatio: 4.5, usage: "Label on danger hover" },
  { id: "danger-on-white", foreground: "#CE071B", background: "#FFFFFF", minRatio: 4.5, usage: "Error text" },
  { id: "danger-on-danger-bg", foreground: "#CE071B", background: "#FDECEE", minRatio: 4.5, usage: "Error text on danger surface" },
  { id: "success-on-success-bg", foreground: "#064B36", background: "#E5F3EC", minRatio: 4.5, usage: "Success badge text" },
  { id: "warning-on-white", foreground: "#9A4A00", background: "#FFFFFF", minRatio: 4.5, usage: "Warning text. Brand orange #F58220 is not used as text on white" },
  { id: "warning-on-warning-bg", foreground: "#9A4A00", background: "#FFF4E6", minRatio: 4.5, usage: "Warning badge text" },
  { id: "info-on-white", foreground: "#0C4A6E", background: "#FFFFFF", minRatio: 4.5, usage: "Info text" },
  { id: "info-on-info-bg", foreground: "#0C4A6E", background: "#E7F2F8", minRatio: 4.5, usage: "Info badge text" },
  { id: "dark-on-orange", foreground: "#142526", background: "#F58220", minRatio: 4.5, usage: "Text on orange accent fill" },
  { id: "gold-on-dark", foreground: "#B9A17A", background: "#142526", minRatio: 4.5, usage: "Gold text on dark brand surface only" },
  { id: "gold-on-green-ui", foreground: "#B9A17A", background: "#064B36", minRatio: 3, usage: "Gold as large text or non-text UI on primary green. Not body text (under 4.5)" },
  { id: "border-on-white", foreground: "#6A8178", background: "#FFFFFF", minRatio: 3, usage: "Input border against surface" },
  { id: "border-on-background", foreground: "#6A8178", background: "#F5F7F6", minRatio: 3, usage: "Input border against page background" },
  { id: "focus-on-background", foreground: "#064B36", background: "#F5F7F6", minRatio: 3, usage: "Focus ring against page background" }
];

/** Brand colours that must not be used as text or meaningful UI on light surfaces. */
export const disallowedLightTextPairs: ContrastPair[] = [
  { id: "gold-on-white", foreground: "#B9A17A", background: "#FFFFFF", minRatio: 3, usage: "Fails AA. Do not use gold text or gold-only borders on white" },
  { id: "gold-on-background", foreground: "#B9A17A", background: "#F5F7F6", minRatio: 3, usage: "Fails AA on the page background" },
  { id: "orange-on-white", foreground: "#F58220", background: "#FFFFFF", minRatio: 3, usage: "Fails AA. Orange is a fill with dark text, not text on white" },
  { id: "orange-on-background", foreground: "#F58220", background: "#F5F7F6", minRatio: 3, usage: "Fails AA on the page background" }
];
