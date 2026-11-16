/**
 * Private nested freeze for the rule tables (SD-PC-08). The same file exists in
 * src/sim/player, src/weapons and src/combat because the three components share
 * no edge; tests/arch/player-combat-surface.test.ts asserts the copies are
 * byte-identical. Tables are shallow and acyclic, so no visited set is needed.
 */
export function freezeNested<T extends object>(value: T): Readonly<T> {
  for (const key of Object.keys(value)) {
    const child: unknown = (value as Record<string, unknown>)[key];
    if (typeof child === 'object' && child !== null && !Object.isFrozen(child)) {
      freezeNested(child);
    }
  }
  return Object.freeze(value);
}
