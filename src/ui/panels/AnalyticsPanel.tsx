import React, { useMemo } from 'react';
import { Text, useInput } from 'ink';
import { Modal } from './Modal.js';
import type { UIMessage, ToolRun } from '../types.js';

export function AnalyticsPanel(props: {
  messages: UIMessage[];
  tokens: number;
  cost: number;
  tools: ToolRun[];
  usage?: Record<string, number>;
  model?: string;
  provider?: string;
  onClose: () => void;
}) {
  useInput((ch, key) => {
    if (key.escape) props.onClose();
  });

  const stats = useMemo(() => {
    const pinned = props.messages.filter((m) => m.pinned).length;
    const ups = props.messages.reduce((a, m) => a + ((m.reactions ?? []).includes('up') ? 1 : 0), 0);
    const downs = props.messages.reduce((a, m) => a + ((m.reactions ?? []).includes('down') ? 1 : 0), 0);
    const users = props.messages.filter((m) => m.role === 'user').length;
    const assistants = props.messages.filter((m) => m.role === 'assistant').length;

    const buckets = new Map<string, { count: number; tokens: number; cost: number }>();
    for (const m of props.messages as any[]) {
      const p = m.provider ?? props.provider ?? 'unknown';
      const model = m.model ?? props.model ?? 'unknown';
      const key = `${p}:${model}`;
      const cur = buckets.get(key) ?? { count: 0, tokens: 0, cost: 0 };
      cur.count += 1;
      cur.tokens += Number(m.tokensDelta ?? 0);
      cur.cost += Number(m.costDelta ?? 0);
      buckets.set(key, cur);
    }

    const bucketsArr = [...buckets.entries()]
      .sort((a, b) => b[1].cost - a[1].cost || b[1].tokens - a[1].tokens || b[1].count - a[1].count);

    return { pinned, ups, downs, users, assistants, buckets: bucketsArr };
  }, [props.messages, props.model, props.provider]);

  return (
    <Modal title="Analytics" footer="Esc closes">
      <Text>Messages: {props.messages.length} ({stats.users} user / {stats.assistants} assistant)</Text>
      <Text>Pinned: {stats.pinned}</Text>
      <Text>Reactions: 👍 {stats.ups}  👎 {stats.downs}</Text>
      <Text>Tools: {props.tools.length} runs</Text>
      <Text>Provider: {props.provider ?? '(unknown)'}</Text>
      <Text>Model: {props.model ?? '(unknown)'}</Text>
      <Text>Tokens: {props.tokens}</Text>
      <Text>Cost: ${props.cost.toFixed(6)}</Text>

      <Text>Buckets (provider:model):</Text>
      {stats.buckets.slice(0, 8).map(([k, v]) => (
        <Text key={k} dimColor>
          - {k}: {v.count} msg · {v.tokens} tok · ${v.cost.toFixed(6)}
        </Text>
      ))}

      {props.usage ? (
        <>
          <Text>Usage:</Text>
          {Object.entries(props.usage)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
            .map(([k, v]) => (
              <Text key={k} dimColor>
                - {k}: {v}
              </Text>
            ))}
        </>
      ) : null}
    </Modal>
  );
}
