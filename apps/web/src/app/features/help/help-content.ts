/**
 * The in-app guide: its STRUCTURE lives here, its TEXTS in the message files under `help.*`
 * (`en.json` + `de-CH.json`, same keys). A section is a numbered step of the guide; its texts are
 * `help.sections.<id>.{title,purpose,where}`, `….steps.<item>` and `….tips.<item>`. Change the
 * app -> change the help.
 */
export interface HelpSection {
  readonly id: string;
  readonly steps: readonly string[];
  readonly tips: readonly string[];
  /** Pages to open: label `help.links.<id>`, path below `/app`. */
  readonly links: readonly { readonly id: string; readonly path: string }[];
}

export const HELP_SECTIONS: readonly HelpSection[] = [
  {
    id: 'pin',
    steps: ['setPin', 'lock', 'change'],
    tips: ['autoLock', 'forgot'],
    links: [{ id: 'settings', path: '/app/settings' }],
  },
  {
    id: 'connections',
    steps: ['add', 'test', 'save'],
    tips: ['password', 'docker'],
    links: [{ id: 'connections', path: '/app/connections' }],
  },
  {
    id: 'replicate',
    steps: ['pickSource', 'pickTarget', 'start', 'cancel'],
    tips: ['sameType', 'overwrite'],
    links: [{ id: 'replicate', path: '/app/replicate' }],
  },
  {
    id: 'docker',
    steps: ['list', 'pick'],
    tips: ['dockerRunning'],
    links: [{ id: 'replicate', path: '/app/replicate' }],
  },
  {
    id: 'log',
    steps: ['open', 'select'],
    tips: ['secrets'],
    links: [{ id: 'log', path: '/app/log' }],
  },
];

export const HELP_FAQ: readonly string[] = [
  'databases',
  'mixed',
  'forgotPin',
  'data',
  'overwrite',
];

/** Every text key the guide reads (for the i18n spec; the keys are built at runtime). */
export function allHelpKeys(): string[] {
  return [
    ...HELP_SECTIONS.flatMap((section) => [
      `help.sections.${section.id}.title`,
      `help.sections.${section.id}.purpose`,
      `help.sections.${section.id}.where`,
      ...section.steps.map((s) => `help.sections.${section.id}.steps.${s}`),
      ...section.tips.map((t) => `help.sections.${section.id}.tips.${t}`),
      ...section.links.map((l) => `help.links.${l.id}`),
    ]),
    ...HELP_FAQ.flatMap((id) => [
      `help.faq.items.${id}.question`,
      `help.faq.items.${id}.answer`,
    ]),
  ];
}
