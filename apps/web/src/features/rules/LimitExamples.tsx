import { type LimitExampleTopic, limitExamples, limitExampleTopics } from '@rowing/core';
import { gaugeId } from '../../lib/format.ts';

const topics = Object.keys(limitExampleTopics) as LimitExampleTopic[];

// Published club rules, collapsed, to show how limits are worded. Read only: nothing here fills
// in or applies a limit, so an example never becomes a default (decision 0001).
export function LimitExamples() {
  return (
    <details className="limit-examples">
      <summary>How some clubs word their limits</summary>
      <p className="hint">
        Summaries of published club policies. Each applies to that club’s water and boats, and clubs
        differ widely. Enter your own club’s limits.
      </p>
      {topics.map((topic) => (
        <section key={topic}>
          <h3>{limitExampleTopics[topic]}</h3>
          <ul>
            {limitExamples
              .filter((e) => e.topic === topic)
              .map((e) => (
                <li key={e.club}>
                  <strong>{e.club}</strong> ({e.place}): {e.text}
                  {e.topic === 'flow' &&
                    ` Measured at ${e.gauge.name} (${gaugeId(e.gauge.ref)}), so it applies to that gauge on that river only.`}{' '}
                  <a href={e.source.url} target="_blank" rel="noopener noreferrer">
                    {e.source.title}
                  </a>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </details>
  );
}
