import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  tutorialSidebar: [
    'intro',
    'getting-started',
    {
      type: 'category',
      label: 'Guides',
      collapsed: false,
      items: [
        'guides/architecture',
        'guides/circuit-states',
        'guides/healthchecks',
        'guides/metrics',
        'guides/best-practices',
        'guides/development',
      ],
    },
    {
      type: 'category',
      label: 'Strategies',
      collapsed: false,
      items: ['strategies/breaker-strategies', 'strategies/backoff-strategies'],
    },
    {
      type: 'category',
      label: 'API Reference',
      collapsed: false,
      items: [
        'api/circuit-breaker',
        'api/enums-and-errors',
        'api/interfaces-and-types',
      ],
    },
  ],
};

export default sidebars;
