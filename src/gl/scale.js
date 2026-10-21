// Asset sizes in one place (Phase 1b sizing revamp). World units; the island is ~18 u across, a sim cell 0.156 u.
// Anchor: dwellings, monoliths and the island keep their size (camera framing, shadow stamps and glow pools are
// tuned to them); villagers, grass and trees are sized against them. Target proportions in villager heights H:
// cottage eaves ~1.3 H and ridge ~2 H, grass <= ~0.5 H, trees ~3 H.
export const SIZE = {
  villager: 0.68,      // instance scale of the 0.40-tall villager model (was 1.1 -> 0.44 tall; now ~0.27)
  villagerBob: 0.6,    // walk bob / greeting hop amplitude, relative to the old values
  villagerStride: 1.6, // walk-cycle steps per unit distance, relative to the old rate (shorter legs step more often)
  grassY: 0.3,         // flora blade height factor (was 0.58)
  grassXZ: 0.5,        // flora blade footprint factor (was 0.58; kept wider than the height cut so ground stays covered)
  treeY: 1.1,          // tree trunk + crown height factor (was 0.58, shared with the blades)
  treeXZ: 1.15,        // tree crown footprint factor
};

// GLSL float literal (always with a decimal point)
export function glslF(x) { return Number.isInteger(x) ? x.toFixed(1) : String(x); }
