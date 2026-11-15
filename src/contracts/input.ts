export interface InputCommand {
  tick: number;
  move: { x: -1 | 0 | 1; z: -1 | 0 | 1 };
  lookDx: number;
  lookDy: number;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
  fire: boolean;
  firePressed: boolean;
  scope: boolean;
  reload: boolean;
  select: 0 | 1 | 2 | null;
  cycle: -1 | 0 | 1;
}
