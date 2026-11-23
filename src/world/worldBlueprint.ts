export type HutDecayState = 'intact' | 'sagging' | 'roofless' | 'ruins';

export interface BuildingBlueprint {
  offsetX: number;
  offsetZ: number;
  rotY: number;
  w: number;
  d: number;
  h: number;
  roofStyle: 'thatch' | 'shingle';
  warmWood: boolean;
  porch: boolean;
  abandoned: boolean;
  decayState: HutDecayState;
  name: string;
}

export interface FenceSegmentBlueprint {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface VillageBlueprint {
  id: string;
  name: string;
  estonianLabel: string;
  x: number;
  z: number;
  clearingRadius: number;
  flattenHeight: number;
  abandoned: boolean;
  buildings: BuildingBlueprint[];
  fences: FenceSegmentBlueprint[];
}

export interface RoadSegmentBlueprint {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  halfWidth: number;
  isTrail: boolean;
}

export interface SwampIslandBlueprint {
  id: string;
  name: string;
  x: number;
  z: number;
  radius: number;
  peakHeight: number;
  linkedByBoardwalk: boolean;
  hut: {
    w: number;
    d: number;
    h: number;
    rotY: number;
    roofStyle: 'thatch' | 'shingle';
    decayState: HutDecayState;
    name: string;
  } | null;
}

export interface WorldBlueprint {
  seed: number;
  mainRoadPhase: number;
  mainRoadAmp: number;
  mainRoadSlope: number;
  bogCenterX: number;
  bogCenterZ: number;
  bogRadius: number;
  villages: VillageBlueprint[];
  roadSegments: RoadSegmentBlueprint[];
  swampIslands: SwampIslandBlueprint[];
}

function seededRand(seed: number): () => number {
  let s = (seed | 0) ^ 0x9e3779b9;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VILLAGE_POOL = [
  { name: 'Kivimäe', estonianLabel: 'Kivimäe küla (Stone Hill Hamlet)' },
  { name: 'Tühja-Metsa', estonianLabel: 'Tühja-Metsa (Abandoned Woodland Village)' },
  { name: 'Laanemetsa', estonianLabel: 'Laanemetsa talu (Deepwood Homestead)' },
  { name: 'Kuusiku', estonianLabel: 'Kuusiku küla (Spruce Grove Village)' },
  { name: 'Tammeoru', estonianLabel: 'Tammeoru talu (Oak Hollow Farm)' },
  { name: 'Männiku', estonianLabel: 'Männiku küla (Pine Ridge Hamlet)' },
  { name: 'Põdrasoo', estonianLabel: 'Põdrasoo talud (Elk Bog Cottages)' },
];

const ISLAND_NAMES = [
  'Rabasaar I (Moor Island)',
  'Turvasaar (Peat Knoll)',
  'Sookase saar (Bog Birch Island)',
  'Vana Vahtkonnasaar (Watchman’s Isle)',
  'Udupesa saar (Mist-Nest Island)',
  'Jõhvikasaar (Cranberry Isle)',
  'Samblasaar (Mossy Hummock Isle)',
];

function evalMainRoadX(z: number, phase: number, amp: number, slope: number): number {
  return Math.sin(z * 0.018 + phase) * amp - Math.max(0, z) * slope + Math.sin(z * 0.0055) * 16;
}

export function generateWorldBlueprint(seed: number): WorldBlueprint {
  const rand = seededRand(seed);

  const mainRoadPhase = (rand() - 0.5) * 0.45;
  const mainRoadAmp = 13 + rand() * 5;
  const mainRoadSlope = 0.24 + rand() * 0.14;

  // Large SE peat bog starting close enough to hike to, extending deep across ~230m
  const bogCenterX = 148 + (rand() - 0.5) * 18;
  const bogCenterZ = 98 + (rand() - 0.5) * 16;
  const bogRadius = 118 + rand() * 14;

  // Village 0: Starting Homestead Vana-Kase north of spawn (0, 6)
  const v0X = Math.round(evalMainRoadX(-28, mainRoadPhase, mainRoadAmp, mainRoadSlope) + 3.5);
  const v0Z = -28;
  const villages: VillageBlueprint[] = [
    {
      id: 'vana-kase',
      name: 'Vana-Kase',
      estonianLabel: 'Vana-Kase talu (Homestead)',
      x: v0X,
      z: v0Z,
      clearingRadius: 24,
      flattenHeight: 1.4,
      abandoned: false,
      buildings: [
        {
          offsetX: 4,
          offsetZ: -2,
          rotY: 0,
          w: 9.2,
          d: 5.8,
          h: 2.75,
          roofStyle: 'thatch',
          warmWood: false,
          porch: true,
          abandoned: false,
          decayState: 'intact',
          name: 'Vana-Kase Farmhouse',
        },
        {
          offsetX: -9.5,
          offsetZ: 4,
          rotY: Math.PI / 2,
          w: 6.8,
          d: 4.8,
          h: 2.6,
          roofStyle: 'shingle',
          warmWood: false,
          porch: false,
          abandoned: false,
          decayState: 'intact',
          name: 'Log Barn (Ait)',
        },
        {
          offsetX: 11.5,
          offsetZ: 6,
          rotY: -Math.PI / 2,
          w: 4.8,
          d: 3.8,
          h: 2.3,
          roofStyle: 'thatch',
          warmWood: true,
          porch: true,
          abandoned: false,
          decayState: 'intact',
          name: 'Smoke Sauna (Suitsusaun)',
        },
      ],
      fences: [
        { x0: v0X - 15, z0: v0Z + 12, x1: v0X - 15, z1: v0Z - 7 },
        { x0: v0X - 15, z0: v0Z - 7, x1: v0X + 14, z1: v0Z - 7 },
        { x0: v0X + 14, z0: v0Z - 7, x1: v0X + 14, z1: v0Z + 13 },
        // Low front paddock fence right beside the road edge so jumping fences is immediately testable
        { x0: v0X + 5, z0: v0Z + 15, x1: v0X + 14, z1: v0Z + 13 },
      ],
    },
  ];

  // Outer procedural villages placed in 3 far sectors (~210m - 430m out)
  const sectorAnchors = [
    { baseAngle: Math.PI * 0.72, distMin: 185, distMax: 320, abandoned: true },
    { baseAngle: -Math.PI * 0.28, distMin: 240, distMax: 410, abandoned: false },
    { baseAngle: -Math.PI * 0.78, distMin: 250, distMax: 430, abandoned: rand() > 0.35 },
  ];

  const shuffledPool = [...VILLAGE_POOL].sort(() => rand() - 0.5);

  for (let i = 0; i < sectorAnchors.length; i++) {
    const sec = sectorAnchors[i];
    let vx = 0;
    let vz = 0;
    for (let attempt = 0; attempt < 20; attempt++) {
      const ang = sec.baseAngle + (rand() - 0.5) * 0.55;
      const dist = sec.distMin + rand() * (sec.distMax - sec.distMin);
      vx = Math.cos(ang) * dist;
      vz = Math.sin(ang) * dist;
      // Ensure well clear of bog & other villages
      const dBog = Math.hypot(vx - bogCenterX, vz - bogCenterZ);
      const dOther = villages.every((v) => Math.hypot(vx - v.x, vz - v.z) > 150);
      if (dBog > bogRadius + 48 && dOther && Math.hypot(vx, vz) < 490) break;
    }

    const meta = shuffledPool[i % shuffledPool.length];
    const isAbandoned = sec.abandoned;
    const flattenHeight = 1.6 + (rand() - 0.5) * 2.2;
    const buildings: BuildingBlueprint[] = [
      {
        offsetX: -3,
        offsetZ: -5,
        rotY: (rand() - 0.5) * 0.35,
        w: 8.2 + rand() * 1.4,
        d: 5.4 + rand() * 0.8,
        h: 2.65,
        roofStyle: rand() > 0.45 ? 'thatch' : 'shingle',
        warmWood: !isAbandoned && rand() > 0.45,
        porch: rand() > 0.35,
        abandoned: isAbandoned,
        decayState: isAbandoned ? (rand() > 0.5 ? 'sagging' : 'intact') : 'intact',
        name: isAbandoned ? `${meta.name} Old Cottage` : `${meta.name} Farmhouse`,
      },
      {
        offsetX: 9.5,
        offsetZ: 2.5,
        rotY: -Math.PI / 2 + (rand() - 0.5) * 0.25,
        w: 6.4 + rand() * 0.9,
        d: 4.6,
        h: 2.45,
        roofStyle: 'shingle',
        warmWood: false,
        porch: false,
        abandoned: isAbandoned,
        decayState: isAbandoned ? 'roofless' : 'intact',
        name: isAbandoned ? `${meta.name} Derelict Barn` : `${meta.name} Barn`,
      },
      {
        offsetX: -11,
        offsetZ: 8,
        rotY: Math.PI / 2 + (rand() - 0.5) * 0.25,
        w: 5.2,
        d: 4.0,
        h: 2.35,
        roofStyle: 'thatch',
        warmWood: !isAbandoned,
        porch: true,
        abandoned: isAbandoned || rand() > 0.6,
        decayState: isAbandoned ? 'ruins' : 'intact',
        name: isAbandoned ? `${meta.name} Ruined Sauna` : `${meta.name} Sauna`,
      },
    ];

    const fences: FenceSegmentBlueprint[] = [
      { x0: vx - 16, z0: vz + 14, x1: vx - 16, z1: vz - 11 },
      { x0: vx - 16, z0: vz - 11, x1: vx + 15, z1: vz - 11 },
      { x0: vx + 15, z0: vz - 11, x1: vx + 15, z1: vz + 13 },
    ];

    villages.push({
      id: `village-${i + 1}`,
      name: meta.name,
      estonianLabel: meta.estonianLabel,
      x: vx,
      z: vz,
      clearingRadius: 27,
      flattenHeight,
      abandoned: isAbandoned,
      buildings,
      fences,
    });
  }

  // Build connecting winding road & woodland trail segments
  const roadSegments: RoadSegmentBlueprint[] = [];

  // Trailhead spur from starting area near (0, 6) to the bog boardwalk entrance
  const bogTrailStart = { x: evalMainRoadX(8, mainRoadPhase, mainRoadAmp, mainRoadSlope), z: 8 };
  const bogBoardwalkStart = {
    x: bogCenterX - bogRadius * 0.72,
    z: bogCenterZ - bogRadius * 0.44,
  };
  const spurSteps = 4;
  for (let s = 0; s < spurSteps; s++) {
    const t0 = s / spurSteps;
    const t1 = (s + 1) / spurSteps;
    const wob0 = Math.sin(t0 * Math.PI) * 7;
    const wob1 = Math.sin(t1 * Math.PI) * 7;
    roadSegments.push({
      ax: bogTrailStart.x + (bogBoardwalkStart.x - bogTrailStart.x) * t0 - wob0,
      az: bogTrailStart.z + (bogBoardwalkStart.z - bogTrailStart.z) * t0 + wob0 * 0.6,
      bx: bogTrailStart.x + (bogBoardwalkStart.x - bogTrailStart.x) * t1 - wob1,
      bz: bogTrailStart.z + (bogBoardwalkStart.z - bogTrailStart.z) * t1 + wob1 * 0.6,
      halfWidth: 1.9,
      isTrail: true,
    });
  }

  // Country gravel spur roads linking outer villages back to the main road
  for (let i = 1; i < villages.length; i++) {
    const v = villages[i];
    const targetZ = Math.max(-520, Math.min(520, v.z));
    const targetX = evalMainRoadX(targetZ, mainRoadPhase, mainRoadAmp, mainRoadSlope);
    const segCount = 5;
    for (let s = 0; s < segCount; s++) {
      const t0 = s / segCount;
      const t1 = (s + 1) / segCount;
      const arc0 = Math.sin(t0 * Math.PI) * (v.x > 0 ? -18 : 18);
      const arc1 = Math.sin(t1 * Math.PI) * (v.x > 0 ? -18 : 18);
      roadSegments.push({
        ax: targetX + (v.x - targetX) * t0,
        az: targetZ + (v.z - targetZ) * t0 + arc0,
        bx: targetX + (v.x - targetX) * t1,
        bz: targetZ + (v.z - targetZ) * t1 + arc1,
        halfWidth: 2.9,
        isTrail: false,
      });
    }
  }

  // 7 Elevated Swamp Islands inside the bog, many with decaying/roofless abandoned huts
  const decayCycle: HutDecayState[] = [
    'roofless',
    'sagging',
    'ruins',
    'roofless',
    'intact',
    'ruins',
    'sagging',
  ];
  const swampIslands: SwampIslandBlueprint[] = [];
  const islandCount = 7;
  for (let i = 0; i < islandCount; i++) {
    const ang = (i / islandCount) * Math.PI * 2 + (rand() - 0.5) * 0.42;
    const radialFrac = i === 0 ? 0.22 : 0.34 + (i % 3) * 0.18 + rand() * 0.1;
    const rad = Math.min(bogRadius * 0.78, bogRadius * radialFrac);
    const ix = bogCenterX + Math.cos(ang) * rad;
    const iz = bogCenterZ + Math.sin(ang) * rad;
    const radius = 14.5 + rand() * 9.5;
    const peakHeight = 0.95 + rand() * 1.1; // High enough to stand cleanly above SWAMP_WATER_Y (-1.22)
    const hasHut = i < 5 || rand() > 0.4;
    const decayState = decayCycle[(i + Math.abs(seed | 0)) % decayCycle.length];

    swampIslands.push({
      id: `island-${i}`,
      name: ISLAND_NAMES[i % ISLAND_NAMES.length],
      x: ix,
      z: iz,
      radius,
      peakHeight,
      linkedByBoardwalk: i < 3,
      hut: hasHut
        ? {
            w: 4.6 + rand() * 1.6,
            d: 3.6 + rand() * 1.2,
            h: 2.15 + rand() * 0.45,
            rotY: rand() * Math.PI * 2,
            roofStyle: rand() > 0.4 ? 'thatch' : 'shingle',
            decayState,
            name:
              decayState === 'roofless'
                ? 'Roofless Bog Hut'
                : decayState === 'ruins'
                  ? 'Ruined Peat Hut'
                  : 'Abandoned Bog Cabin',
          }
        : null,
    });
  }

  return {
    seed,
    mainRoadPhase,
    mainRoadAmp,
    mainRoadSlope,
    bogCenterX,
    bogCenterZ,
    bogRadius,
    villages,
    roadSegments,
    swampIslands,
  };
}
