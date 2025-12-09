import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  tutorialSidebar: [
    'intro',
    'getting-started',
    {
      type: 'category',
      label: 'API Reference',
      collapsed: false,
      items: ['api/circuit-breaker'],
    },
    {
      type: 'category',
      label: 'Strategies',
      collapsed: false,
      items: ['strategies/breaker-strategies', 'strategies/backoff-strategies'],
    },
    {
      type: 'category',
      label: 'Guides',
      collapsed: false,
      items: [
        'guides/architecture',
        'guides/metrics',
        'guides/circuit-states',
        'guides/idle-healthchecks',
        'guides/best-practices',
      ],
    },
    'development',
  ],
};

export default sidebars;
