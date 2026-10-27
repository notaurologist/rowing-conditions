// A course on the Connecticut River above the Turners Falls dam, each point tapped about 50 m off
// the centerline, as a dock or a turn on the bank would be. Shared by the fixture recorder and
// the tests that use its recording (overpass/waterways-turners-falls).
export const COURSE_START: [number, number] = [42.605, -72.5448];
export const COURSE_TURN: [number, number] = [42.6422, -72.4819];

// A loop at Northampton (#142): from the Connecticut River Greenway boat launch just upstream of
// the Norwottuck Rail Trail bridge, down the side channel and under the bridge, up the main channel
// beside Elwell Island, around its head, and back down the side channel. One tap in each channel.
export const NORTHAMPTON_DOCK: [number, number] = [42.33517, -72.62029];
export const NORTHAMPTON_LOOP: [number, number][] = [
  NORTHAMPTON_DOCK,
  [42.336, -72.6168], // below the bridge, where the channels meet
  [42.3422, -72.6202], // main channel beside the island
  [42.3448, -72.6315], // head of the island
  NORTHAMPTON_DOCK,
];
