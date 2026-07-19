/**
 * Deterministic Olympic-style dataset generator. Same count → identical rows,
 * always (seeded PRNG, no Date.now / Math.random anywhere).
 */

export interface Row {
  id: string;
  athlete: string;
  country: string;
  sport: string;
  year: number;
  date: Date;
  gold: number;
  silver: number;
  bronze: number;
  total: number;
}

export const COUNTRIES: string[] = [
  'United States', 'China', 'Great Britain', 'Russia', 'Germany', 'Japan',
  'France', 'Australia', 'Italy', 'Canada', 'South Korea', 'Netherlands',
  'Brazil', 'Spain', 'Kenya', 'Jamaica', 'Norway', 'Sweden', 'Hungary',
  'Ukraine', 'Poland', 'Cuba', 'New Zealand', 'Ethiopia',
];

export const SPORTS: string[] = [
  'Swimming', 'Athletics', 'Gymnastics', 'Cycling', 'Rowing', 'Fencing',
  'Judo', 'Wrestling', 'Boxing', 'Shooting', 'Archery', 'Weightlifting',
  'Sailing', 'Canoeing', 'Taekwondo', 'Diving',
];

const FIRST_NAMES: string[] = [
  'Michael', 'Natalie', 'Ryan', 'Katie', 'Aaron', 'Dara', 'Jason', 'Rebecca',
  'Ian', 'Amanda', 'Cullen', 'Elena', 'Marcus', 'Sofia', 'Dmitry', 'Yuki',
  'Pierre', 'Ingrid', 'Carlos', 'Amara', 'Viktor', 'Lucia', 'Henrik', 'Wei',
];

const LAST_NAMES: string[] = [
  'Phelps', 'Coughlin', 'Lochte', 'Hoff', 'Peirsol', 'Torres', 'Lezak',
  'Soni', 'Crocker', 'Beard', 'Jones', 'Ivanova', 'Chen', 'Rossi', 'Tanaka',
  'Dubois', 'Larsen', 'Silva', 'Okafor', 'Petrov', 'Garcia', 'Nilsson',
  'Kovacs', 'Zhang',
];

/** mulberry32 — tiny deterministic PRNG, uniform in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Skewed medal count 0..8, most rows low. */
function medals(rnd: () => number): number {
  const r = rnd();
  return Math.floor(r * r * 9);
}

export function makeRows(count: number, seed = 42): Row[] {
  const rnd = mulberry32(seed);
  const rows: Row[] = new Array<Row>(count);
  for (let i = 0; i < count; i++) {
    const first = FIRST_NAMES[Math.floor(rnd() * FIRST_NAMES.length)];
    const last = LAST_NAMES[Math.floor(rnd() * LAST_NAMES.length)];
    const country = COUNTRIES[Math.floor(rnd() * COUNTRIES.length)];
    const sport = SPORTS[Math.floor(rnd() * SPORTS.length)];
    const year = 2000 + 2 * Math.floor(rnd() * 13); // 2000..2024, even years
    const month = Math.floor(rnd() * 12);
    const day = 1 + Math.floor(rnd() * 28);
    const gold = medals(rnd);
    const silver = medals(rnd);
    const bronze = medals(rnd);
    rows[i] = {
      id: `r${i}`,
      athlete: `${first} ${last}`,
      country,
      sport,
      year,
      date: new Date(year, month, day),
      gold,
      silver,
      bronze,
      total: gold + silver + bronze,
    };
  }
  return rows;
}
