/** S4 About: original-assets statement, runtime libraries and version (BR-MS-25). */
import { el, setText, text, type TextHandle } from '../components/dom';
import { createScope, type Scope } from '../components/scope';
import type { Screen } from '../components/screen';
import { ABOUT_CONTENT } from './about-content';
import type { AboutVM } from './view-models';

export function createAboutScreen(): Screen<AboutVM> {
  let scope: Scope | null = null;
  let heading: HTMLHeadingElement | null = null;
  let version: TextHandle | null = null;
  let last: AboutVM | null = null;
  return {
    mount(root: HTMLElement, vm: AboutVM): void {
      if (scope !== null) this.unmount();
      const s = createScope();
      scope = s;
      last = vm;
      const node = el('section', { cls: 'sz-about', testId: 'about-screen' });
      heading = el(
        'h2',
        { cls: 'sz-panel__title', text: ABOUT_CONTENT.title, attrs: { tabindex: '-1' } },
        node,
      );
      el('p', { text: ABOUT_CONTENT.summary }, node);
      el(
        'p',
        { cls: 'sz-about__assets', text: ABOUT_CONTENT.assets, testId: 'about-assets' },
        node,
      );
      el('h3', { text: ABOUT_CONTENT.librariesHeading }, node);
      const list = el('ul', { testId: 'about-libraries' }, node);
      for (const lib of ABOUT_CONTENT.libraries)
        el('li', { text: `${lib.name} (${lib.licence})` }, list);
      const p = el('p', { cls: 'sz-about__version', testId: 'about-version' }, node);
      p.append(document.createTextNode(`${ABOUT_CONTENT.versionLabel} `));
      version = text(p, vm.version);
      root.appendChild(node);
      s.add(() => {
        node.remove();
      });
    },
    update(vm: AboutVM): void {
      if (scope === null || version === null || vm === last) return;
      last = vm;
      setText(version, vm.version);
    },
    unmount(): void {
      scope?.dispose();
      scope = null;
      heading = null;
      version = null;
      last = null;
    },
    focusFirst(): void {
      heading?.focus();
    },
  };
}
