// The canonical 30-lane RFx list (§3.1 / §4.1 of the functional plan).
// Fixed order via `laneIndex` — this is what extraction chunking batches by
// (lib/ai/extraction) and what "partial lane coverage" / "unsolicited lane"
// edge cases are checked against.

export type CanonicalLane = {
  laneIndex: number;
  originCity: string;
  originState: string;
  destCity: string;
  destState: string;
  expectedVolumeKgPerMonth: number;
  weightBand: string;
};

export const CANONICAL_LANES: CanonicalLane[] = [
  { originCity: "Mumbai", originState: "Maharashtra", destCity: "Pune", destState: "Maharashtra", expectedVolumeKgPerMonth: 42000, weightBand: "500-1000 kg" },
  { originCity: "Mumbai", originState: "Maharashtra", destCity: "Ahmedabad", destState: "Gujarat", expectedVolumeKgPerMonth: 38000, weightBand: "1000-2500 kg" },
  { originCity: "Delhi", originState: "Delhi", destCity: "Jaipur", destState: "Rajasthan", expectedVolumeKgPerMonth: 51000, weightBand: "500-1000 kg" },
  { originCity: "Delhi", originState: "Delhi", destCity: "Chandigarh", destState: "Punjab", expectedVolumeKgPerMonth: 29000, weightBand: "1000-2500 kg" },
  { originCity: "Delhi", originState: "Delhi", destCity: "Lucknow", destState: "Uttar Pradesh", expectedVolumeKgPerMonth: 33000, weightBand: "2500-5000 kg" },
  { originCity: "Bengaluru", originState: "Karnataka", destCity: "Chennai", destState: "Tamil Nadu", expectedVolumeKgPerMonth: 46000, weightBand: "1000-2500 kg" },
  { originCity: "Bengaluru", originState: "Karnataka", destCity: "Hyderabad", destState: "Telangana", expectedVolumeKgPerMonth: 40000, weightBand: "500-1000 kg" },
  { originCity: "Bengaluru", originState: "Karnataka", destCity: "Kochi", destState: "Kerala", expectedVolumeKgPerMonth: 21000, weightBand: "1000-2500 kg" },
  { originCity: "Chennai", originState: "Tamil Nadu", destCity: "Coimbatore", destState: "Tamil Nadu", expectedVolumeKgPerMonth: 27000, weightBand: "500-1000 kg" },
  { originCity: "Chennai", originState: "Tamil Nadu", destCity: "Madurai", destState: "Tamil Nadu", expectedVolumeKgPerMonth: 18000, weightBand: "500-1000 kg" },
  { originCity: "Kolkata", originState: "West Bengal", destCity: "Bhubaneswar", destState: "Odisha", expectedVolumeKgPerMonth: 24000, weightBand: "1000-2500 kg" },
  { originCity: "Kolkata", originState: "West Bengal", destCity: "Guwahati", destState: "Assam", expectedVolumeKgPerMonth: 15000, weightBand: "2500-5000 kg" },
  { originCity: "Kolkata", originState: "West Bengal", destCity: "Patna", destState: "Bihar", expectedVolumeKgPerMonth: 22000, weightBand: "1000-2500 kg" },
  { originCity: "Hyderabad", originState: "Telangana", destCity: "Vijayawada", destState: "Andhra Pradesh", expectedVolumeKgPerMonth: 19000, weightBand: "500-1000 kg" },
  { originCity: "Hyderabad", originState: "Telangana", destCity: "Nagpur", destState: "Maharashtra", expectedVolumeKgPerMonth: 23000, weightBand: "1000-2500 kg" },
  { originCity: "Ahmedabad", originState: "Gujarat", destCity: "Surat", destState: "Gujarat", expectedVolumeKgPerMonth: 31000, weightBand: "500-1000 kg" },
  { originCity: "Ahmedabad", originState: "Gujarat", destCity: "Indore", destState: "Madhya Pradesh", expectedVolumeKgPerMonth: 26000, weightBand: "1000-2500 kg" },
  { originCity: "Pune", originState: "Maharashtra", destCity: "Nashik", destState: "Maharashtra", expectedVolumeKgPerMonth: 20000, weightBand: "500-1000 kg" },
  { originCity: "Pune", originState: "Maharashtra", destCity: "Goa", destState: "Goa", expectedVolumeKgPerMonth: 12000, weightBand: "1000-2500 kg" },
  { originCity: "Delhi", originState: "Delhi", destCity: "Dehradun", destState: "Uttarakhand", expectedVolumeKgPerMonth: 14000, weightBand: "500-1000 kg" },
  { originCity: "Delhi", originState: "Delhi", destCity: "Shimla", destState: "Himachal Pradesh", expectedVolumeKgPerMonth: 9000, weightBand: "500-1000 kg" },
  { originCity: "Mumbai", originState: "Maharashtra", destCity: "Indore", destState: "Madhya Pradesh", expectedVolumeKgPerMonth: 25000, weightBand: "2500-5000 kg" },
  { originCity: "Mumbai", originState: "Maharashtra", destCity: "Goa", destState: "Goa", expectedVolumeKgPerMonth: 17000, weightBand: "1000-2500 kg" },
  { originCity: "Bengaluru", originState: "Karnataka", destCity: "Mangaluru", destState: "Karnataka", expectedVolumeKgPerMonth: 16000, weightBand: "500-1000 kg" },
  { originCity: "Chennai", originState: "Tamil Nadu", destCity: "Vijayawada", destState: "Andhra Pradesh", expectedVolumeKgPerMonth: 20000, weightBand: "1000-2500 kg" },
  { originCity: "Jaipur", originState: "Rajasthan", destCity: "Udaipur", destState: "Rajasthan", expectedVolumeKgPerMonth: 11000, weightBand: "500-1000 kg" },
  { originCity: "Lucknow", originState: "Uttar Pradesh", destCity: "Kanpur", destState: "Uttar Pradesh", expectedVolumeKgPerMonth: 18000, weightBand: "500-1000 kg" },
  { originCity: "Kochi", originState: "Kerala", destCity: "Thiruvananthapuram", destState: "Kerala", expectedVolumeKgPerMonth: 13000, weightBand: "500-1000 kg" },
  { originCity: "Nagpur", originState: "Maharashtra", destCity: "Raipur", destState: "Chhattisgarh", expectedVolumeKgPerMonth: 16000, weightBand: "1000-2500 kg" },
  { originCity: "Guwahati", originState: "Assam", destCity: "Shillong", destState: "Meghalaya", expectedVolumeKgPerMonth: 7000, weightBand: "500-1000 kg" },
].map((lane, laneIndex) => ({ laneIndex, ...lane }));
