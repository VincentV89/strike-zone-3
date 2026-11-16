/** README content the final report and req-final-report rely on (BR-VE-56). */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readmeControls } from '../../scripts/verification/run-report.ts';

const readme = readFileSync('README.md', 'utf8');
const infra = readFileSync('infra/README.md', 'utf8');

describe('README (BR-VE-56)', () => {
  it('states the supported browsers and that Safari is best-effort', () => {
    expect(readme).toContain('Chrome, Edge and Firefox');
    expect(readme).toContain('Safari is best-effort');
  });

  it('recommends Low for 15 and 20 bots', () => {
    expect(readme).toContain('Low is the recommended preset for 15 and 20 bots');
  });

  it('has build, dev, deploy and cleanup instructions', () => {
    expect(readme).toContain('`npm run build`');
    expect(readme).toContain('`npm run dev`');
    expect(`${readme}\n${infra}`).toContain('cdk deploy --all');
    expect(infra).toContain('npx cdk destroy --all');
    expect(infra).toContain('CDKToolkit');
  });

  it('links the final report and manual tests and has a controls table the report can reuse', () => {
    expect(readme).toContain('docs/FINAL-REPORT.md');
    expect(readme).toContain('docs/MANUAL-TESTS.md');
    const table = readmeControls(readme);
    expect(table).not.toBeNull();
    expect(table).toContain('| Crouch        | C ');
    expect(readmeControls('# x\n\n## Controls\n\nno table\n\n## Next\n')).toBeNull();
    expect(readmeControls('# x\n')).toBeNull();
  });
});
