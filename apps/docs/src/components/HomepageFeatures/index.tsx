import Heading from '@theme/Heading';
import clsx from 'clsx';
import type { ReactNode } from 'react';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  icon: string;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Distributed Coordination',
    icon: '🌐',
    description: (
      <>
        Multiple instances coordinate circuit state using Redis, ensuring
        consistent behavior across your services. State changes propagate in
        real-time to all instances.
      </>
    ),
  },
  {
    title: 'Flexible Strategies',
    icon: '⚙️',
    description: (
      <>
        Choose from multiple breaker strategies (consecutive, count, sampling)
        and backoff strategies (constant, exponential) to match your specific
        requirements.
      </>
    ),
  },
  {
    title: 'Leader Election',
    icon: '👑',
    description: (
      <>
        Automatic leader election ensures a single instance manages health
        checks and state transitions, preventing race conditions and reducing
        load on protected services.
      </>
    ),
  },
  {
    title: 'Event-Driven',
    icon: '⚡',
    description: (
      <>
        Real-time state coordination powered by Redis Streams. All instances
        receive immediate updates when circuit state changes, ensuring fast
        response to failures.
      </>
    ),
  },
  {
    title: 'Built-in Observability',
    icon: '📊',
    description: (
      <>
        Native Prometheus metrics integration provides visibility into circuit
        health, call durations, blocked requests, and health check results out
        of the box.
      </>
    ),
  },
  {
    title: 'Production Ready',
    icon: '🚀',
    description: (
      <>
        Battle-tested patterns with proper error handling, graceful shutdown,
        and comprehensive documentation.
      </>
    ),
  },
];

function Feature({ title, icon, description }: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center" style={{ fontSize: '4rem' }}>
        {icon}
      </div>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
