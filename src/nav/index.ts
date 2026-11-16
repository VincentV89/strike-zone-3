/**
 * navigation public surface (src/nav). Other components import this file
 * only; graph internals, A* and the baker's work list are private (SD-CN-03).
 */
export { bakeNavGraph, createNavBaker } from './baker';
export { createPathService } from './path-service';
export { navReport } from './report';
export {
  ATTACH_RADIUS,
  CACHE_SIZE,
  MAX_CACHE_HITS_PER_TICK,
  MAX_PATHS_PER_TICK,
  MAX_QUEUE,
  NAV_MAX_NEIGHBOURS,
  NAV_MAX_NODES,
  NAV_SPACING,
} from './constants';
export { NAV_DIAGNOSTIC_CODES, type NavDiagnosticCode } from './diagnostics';
export type {
  AnchorList,
  AnchorRef,
  NavBakeOptions,
  NavBakePhase,
  NavBaker,
  NavGraph,
  NavNode,
  NavNodeId,
  NavNodeKind,
  NavReport,
  PathAvoid,
  PathRequest,
  PathResult,
  PathService,
  PathServiceOptions,
  PathServiceStats,
  PathTicket,
} from './types';
