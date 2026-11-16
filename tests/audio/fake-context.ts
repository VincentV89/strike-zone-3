/**
 * Recording fake of AudioContextLike (tech-stack-decisions-audio). It records
 * every node, connection, parameter automation and start/stop, so tests can
 * walk the graph. `chaos` makes operations throw or reject for the fuzz test.
 */
import type {
  AudioBufferLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
} from '../../src/audio/context';

export type Automation = readonly [method: string, value: number, time: number];

export class FakeParam implements AudioParamLike {
  readonly calls: Automation[] = [];
  constructor(
    public value: number,
    private readonly chaos: () => boolean,
  ) {}
  private rec(method: string, value: number, time: number): this {
    if (this.chaos()) throw new Error(`chaos: ${method}`);
    this.calls.push([method, value, time]);
    return this;
  }
  setValueAtTime(v: number, t: number): this {
    return this.rec('setValueAtTime', v, t);
  }
  exponentialRampToValueAtTime(v: number, t: number): this {
    if (!(v > 0)) throw new RangeError('exponential ramp target must be positive');
    return this.rec('exponentialRampToValueAtTime', v, t);
  }
  setTargetAtTime(v: number, t: number): this {
    return this.rec('setTargetAtTime', v, t);
  }
  cancelScheduledValues(t: number): this {
    return this.rec('cancelScheduledValues', 0, t);
  }
}

export class FakeNode implements AudioNodeLike {
  readonly outputs: FakeNode[] = [];
  readonly inputs: FakeNode[] = [];
  constructor(
    readonly kind: string,
    protected readonly chaos: () => boolean,
  ) {}
  connect(destination: AudioNodeLike): AudioNodeLike {
    if (this.chaos()) throw new Error('chaos: connect');
    const d = destination as FakeNode;
    this.outputs.push(d);
    d.inputs.push(this);
    return destination;
  }
  disconnect(): void {
    for (const d of this.outputs) d.inputs.splice(d.inputs.indexOf(this), 1);
    this.outputs.length = 0;
  }
  get connected(): boolean {
    return this.outputs.length > 0;
  }
}

export class FakeGain extends FakeNode {
  readonly gain: FakeParam;
  constructor(chaos: () => boolean) {
    super('gain', chaos);
    this.gain = new FakeParam(1, chaos);
  }
}

export class FakeSource extends FakeNode {
  onended: ((this: never, ev: never) => unknown) | null = null;
  startedAt: number | null = null;
  startOffset: number | null = null;
  stoppedAt: number | null = null;
  start(when = 0, offset?: number): void {
    if (this.chaos()) throw new Error('chaos: start');
    this.startedAt = when;
    this.startOffset = offset ?? null;
  }
  stop(when = 0): void {
    this.stoppedAt = when;
  }
  /** Simulates the browser's `ended` event. */
  end(): void {
    const h = this.onended as (() => unknown) | null;
    if (h !== null) h();
  }
}

export class FakeOscillator extends FakeSource {
  type: OscillatorType = 'sine';
  readonly frequency: FakeParam;
  constructor(chaos: () => boolean) {
    super('oscillator', chaos);
    this.frequency = new FakeParam(440, chaos);
  }
}

export class FakeBufferSource extends FakeSource {
  buffer: AudioBufferLike | null = null;
  loop = false;
  constructor(chaos: () => boolean) {
    super('buffer-source', chaos);
  }
}

export class FakeBiquad extends FakeNode {
  type: BiquadFilterType = 'lowpass';
  readonly frequency: FakeParam;
  readonly Q: FakeParam;
  constructor(chaos: () => boolean) {
    super('biquad', chaos);
    this.frequency = new FakeParam(350, chaos);
    this.Q = new FakeParam(1, chaos);
  }
}

export class FakePanner extends FakeNode {
  readonly pan: FakeParam;
  constructor(chaos: () => boolean) {
    super('panner', chaos);
    this.pan = new FakeParam(0, chaos);
  }
}

export class FakeCompressor extends FakeNode {
  readonly threshold: FakeParam;
  readonly knee: FakeParam;
  readonly ratio: FakeParam;
  readonly attack: FakeParam;
  readonly release: FakeParam;
  constructor(chaos: () => boolean) {
    super('compressor', chaos);
    this.threshold = new FakeParam(-24, chaos);
    this.knee = new FakeParam(30, chaos);
    this.ratio = new FakeParam(12, chaos);
    this.attack = new FakeParam(0.003, chaos);
    this.release = new FakeParam(0.25, chaos);
  }
}

export class FakeBuffer implements AudioBufferLike {
  readonly data: Float32Array;
  reads = 0;
  constructor(readonly length: number) {
    this.data = new Float32Array(length);
  }
  getChannelData(): Float32Array {
    this.reads++;
    return this.data;
  }
}

/** How resume() behaves. */
export type ResumeMode = 'run' | 'reject' | 'stay-suspended' | 'throw' | 'hang';

export interface FakeOptions {
  resume?: ResumeMode;
  sampleRate?: number;
  chaos?: () => boolean;
  /** Makes suspend()/close() reject. */
  rejectLifecycle?: boolean;
}

export class FakeAudioContext implements AudioContextLike {
  state = 'suspended';
  currentTime = 0;
  readonly sampleRate: number;
  readonly destination: FakeNode;
  onstatechange: ((this: never, ev: never) => unknown) | null = null;
  readonly nodes: FakeNode[] = [];
  readonly buffers: FakeBuffer[] = [];
  resumeMode: ResumeMode;
  resumeCalls = 0;
  suspendCalls = 0;
  closeCalls = 0;
  private readonly chaos: () => boolean;
  private readonly rejectLifecycle: boolean;

  constructor(opts: FakeOptions = {}) {
    this.resumeMode = opts.resume ?? 'run';
    this.sampleRate = opts.sampleRate ?? 4000;
    this.chaos = opts.chaos ?? (() => false);
    this.rejectLifecycle = opts.rejectLifecycle ?? false;
    this.destination = new FakeNode('destination', () => false);
  }

  private add<T extends FakeNode>(node: T): T {
    if (this.chaos()) throw new Error(`chaos: create ${node.kind}`);
    this.nodes.push(node);
    return node;
  }

  resume(): Promise<void> {
    this.resumeCalls++;
    switch (this.resumeMode) {
      case 'run':
        this.state = 'running';
        return Promise.resolve();
      case 'stay-suspended':
        return Promise.resolve();
      case 'reject':
        return Promise.reject(new Error('NotAllowedError'));
      case 'throw':
        throw new Error('resume threw');
      case 'hang':
        return new Promise(() => undefined);
    }
  }
  suspend(): Promise<void> {
    this.suspendCalls++;
    this.state = 'suspended';
    return this.rejectLifecycle ? Promise.reject(new Error('suspend')) : Promise.resolve();
  }
  close(): Promise<void> {
    this.closeCalls++;
    this.state = 'closed';
    return this.rejectLifecycle ? Promise.reject(new Error('close')) : Promise.resolve();
  }
  /** Simulates a browser-initiated state change (Safari interruptions). */
  setStateFromBrowser(state: string): void {
    this.state = state;
    const h = this.onstatechange as (() => unknown) | null;
    if (h !== null) h();
  }
  createGain(): FakeGain {
    return this.add(new FakeGain(this.chaos));
  }
  createOscillator(): FakeOscillator {
    return this.add(new FakeOscillator(this.chaos));
  }
  createBufferSource(): FakeBufferSource {
    return this.add(new FakeBufferSource(this.chaos));
  }
  createBiquadFilter(): FakeBiquad {
    return this.add(new FakeBiquad(this.chaos));
  }
  createStereoPanner(): FakePanner {
    return this.add(new FakePanner(this.chaos));
  }
  createDynamicsCompressor(): FakeCompressor {
    return this.add(new FakeCompressor(this.chaos));
  }
  createBuffer(_channels: number, length: number): FakeBuffer {
    const b = new FakeBuffer(length);
    this.buffers.push(b);
    return b;
  }

  /** Every source node started so far. */
  sources(): FakeSource[] {
    return this.nodes.filter((n): n is FakeSource => n instanceof FakeSource);
  }
  /** Fires `ended` on every started source. */
  endAll(): void {
    for (const s of this.sources()) s.end();
  }
  ofKind(kind: string): FakeNode[] {
    return this.nodes.filter((n) => n.kind === kind);
  }
}

/** A factory that records how often it was called. */
export function fakeFactory(opts: FakeOptions = {}): {
  create: () => FakeAudioContext;
  readonly calls: number;
  readonly last: FakeAudioContext | null;
} {
  let calls = 0;
  let last: FakeAudioContext | null = null;
  return {
    create: () => {
      calls++;
      last = new FakeAudioContext(opts);
      return last;
    },
    get calls() {
      return calls;
    },
    get last() {
      return last;
    },
  };
}

/** Follows outputs from `node` until a node with none; returns the kinds visited. */
export function pathToEnd(node: FakeNode): string[] {
  const kinds: string[] = [node.kind];
  let n = node;
  for (let guard = 0; guard < 32 && n.outputs.length > 0; guard++) {
    const next = n.outputs[0];
    if (next === undefined) break;
    kinds.push(next.kind);
    n = next;
  }
  return kinds;
}
