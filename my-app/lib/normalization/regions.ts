// Shared India-region bucketing — used both for the questionnaire's regional
// coverage checklist (coverage_north/south/east/west/central/northeast) and
// for resolving a from-region/to-region rate matrix (vendor B's rate
// document) down to specific canonical lanes.

export const REGIONS = ["North", "South", "East", "West", "Central", "Northeast"] as const;
export type Region = (typeof REGIONS)[number];

const REGION_BY_STATE: Record<string, Region> = {
  Delhi: "North",
  Rajasthan: "North",
  Punjab: "North",
  "Uttar Pradesh": "North",
  Uttarakhand: "North",
  "Himachal Pradesh": "North",

  Karnataka: "South",
  "Tamil Nadu": "South",
  Kerala: "South",
  Telangana: "South",
  "Andhra Pradesh": "South",

  "West Bengal": "East",
  Odisha: "East",
  Bihar: "East",

  Maharashtra: "West",
  Gujarat: "West",
  Goa: "West",

  "Madhya Pradesh": "Central",
  Chhattisgarh: "Central",

  Assam: "Northeast",
  Meghalaya: "Northeast",
};

export function getRegionForState(state: string): Region {
  const region = REGION_BY_STATE[state];
  if (!region) throw new Error(`No region mapping for state "${state}"`);
  return region;
}

export function regionCoverageFieldKey(region: Region): string {
  return `coverage_${region.toLowerCase()}`;
}

/**
 * Every unique city (origin or destination) across a lane list, bucketed by
 * region. Used to print an explicit "this region means these cities"
 * definition in a region-matrix rate document — a matrix that only names
 * "North/South/East/West" without saying what's in them leaves the reader
 * guessing exactly the kind of ambiguity the extraction pipeline is meant
 * to catch, not reproduce.
 */
export function getCitiesByRegion(
  lanes: { originCity: string; originState: string; destCity: string; destState: string }[]
): Record<Region, string[]> {
  const byRegion = Object.fromEntries(REGIONS.map((r) => [r, new Set<string>()])) as Record<Region, Set<string>>;
  for (const lane of lanes) {
    byRegion[getRegionForState(lane.originState)].add(lane.originCity);
    byRegion[getRegionForState(lane.destState)].add(lane.destCity);
  }
  return Object.fromEntries(
    REGIONS.map((r) => [r, Array.from(byRegion[r]).sort()])
  ) as Record<Region, string[]>;
}
