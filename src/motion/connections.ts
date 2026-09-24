export interface ConnectionSet {
  id: string;
  name: string;
  pairs: [string, string][];
}
const paired = (parts: [string, string][]): [string, string][] =>
  ['L', 'R'].flatMap((side) =>
    parts.map(([a, b]) => [`${side}_${a}`, `${side}_${b}`] as [string, string]),
  );
export const connectionSets: ConnectionSet[] = [
  {
    id: 'ibo-gait',
    name: 'IBO gait · display links',
    pairs: [
      ['L_ASIS', 'R_ASIS'],
      ['L_PSIS', 'R_PSIS'],
      ...paired([
        ['ASIS', 'PSIS'],
        ['ASIS', 'Trochanter'],
        ['Trochanter', 'Knee'],
        ['Knee', 'Ankle'],
        ['Ankle', 'Meta5'],
        ['Meta5', 'ToesTop'],
        ['Meta1', 'ToesTop'],
        ['HeelTop', 'Meta5'],
        ['Acromion', 'ASIS'],
      ]),
      ['L_Acromion', 'R_Acromion'],
    ],
  },
  {
    id: 'ibo-full',
    name: 'IBO full body · display links',
    pairs: [
      ['L_ASIS', 'R_ASIS'],
      ['L_PSIS', 'R_PSIS'],
      ...paired([
        ['ASIS', 'PSIS'],
        ['ASIS', 'Tro'],
        ['Tro', 'KneeLat'],
        ['KneeLat', 'AnkleLat'],
        ['AnkleLat', 'Heel'],
        ['Heel', 'MT5'],
        ['MT5', 'Toe'],
        ['MT1', 'Toe'],
        ['Acro', 'ElbowLat'],
        ['ElbowLat', 'WristLat'],
      ]),
      ['L_Acro', 'R_Acro'],
      ['C7', 'Clavicle'],
      ['Head1', 'Head2'],
      ['Head2', 'Head3'],
      ['Head3', 'Head4'],
      ['Head4', 'Head1'],
    ],
  },
  {
    id: 'plug-in-gait',
    name: 'Plug-in Gait · display links',
    pairs: [
      ['LASI', 'RASI'],
      ['LPSI', 'RPSI'],
      ['LASI', 'LPSI'],
      ['RASI', 'RPSI'],
      ...['L', 'R'].flatMap((s) =>
        [
          ['ASI', 'KNE'],
          ['KNE', 'ANK'],
          ['ANK', 'HEE'],
          ['HEE', 'TOE'],
          ['ANK', 'TOE'],
          ['SHO', 'ELB'],
          ['ELB', 'WRA'],
        ].map(([a, b]) => [s + a, s + b] as [string, string]),
      ),
    ],
  },
];
export function resolveConnections(labels: string[], id: string): [number, number][] {
  if (id === 'none') return [];
  const index = new Map(labels.map((label, i) => [label, i]));
  const sets = id === 'auto' ? connectionSets : connectionSets.filter((s) => s.id === id);
  const seen = new Set<string>(),
    result: [number, number][] = [];
  for (const set of sets)
    for (const [a, b] of set.pairs) {
      const i = index.get(a),
        j = index.get(b);
      if (i != null && j != null && !seen.has(`${i},${j}`)) {
        seen.add(`${i},${j}`);
        result.push([i, j]);
      }
    }
  return result;
}
