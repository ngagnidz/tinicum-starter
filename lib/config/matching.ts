// Tunable thresholds for line-level discrepancy detection (lib/line-matching.ts).
export const MATCHING_CONFIG = {
  /** Absolute currency-unit difference allowed before flagging price_change. */
  priceTolerance: 0,
  /** Percentage difference (0-1) allowed for converted prices before flagging. */
  convertedPriceTolerance: 0.005, // 0.5%
  /** Days after required_date allowed before flagging late_promise. */
  daysLateTolerance: 0,
};
