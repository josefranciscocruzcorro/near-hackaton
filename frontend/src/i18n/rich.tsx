import { Fragment, type ReactNode } from 'react';

/**
 * Fills `{name}` placeholders of a translated template with React nodes (bold names, mono URLs…)
 * so sentences stay whole in each language. Unknown placeholders are left as text.
 */
export function richText(template: string, nodes: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{\w+\})/g).map((part, i) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    const node = name === undefined ? undefined : nodes[name];
    return <Fragment key={i}>{node ?? part}</Fragment>;
  });
}
