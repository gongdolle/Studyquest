import { useMemo } from "react";
import type { SkillGraph, SkillNode, Subject } from "../lib/types";

interface SkillGraphViewProps {
  graphs: readonly SkillGraph[];
  subjects: readonly Subject[];
  selectedSkillId?: string;
  onSelect(skill: SkillNode): void;
}

interface PositionedNode {
  node: SkillNode;
  x: number;
  y: number;
  color: string;
  subjectName: string;
}

const palette = ["#8b7cff", "#35d6b4", "#ffb45b", "#5fb7ff", "#ff718b", "#c9eb63"];

const hash = (value: string) =>
  [...value].reduce((total, character) => total + character.charCodeAt(0), 0);

export const subjectColor = (subject: Pick<Subject, "id" | "name">) =>
  palette[hash(`${subject.id}:${subject.name}`) % palette.length];

export default function SkillGraphView({
  graphs,
  subjects,
  selectedSkillId,
  onSelect,
}: SkillGraphViewProps) {
  const { nodes, edges } = useMemo(() => {
    const width = 940;
    const height = 560;
    const graphCount = Math.max(graphs.length, 1);
    const positions: PositionedNode[] = [];

    graphs.forEach((graph, groupIndex) => {
      const angle = -Math.PI / 2 + (Math.PI * 2 * groupIndex) / graphCount;
      const groupRadius = graphCount === 1 ? 0 : Math.min(185, 70 * graphCount);
      const centerX = width / 2 + Math.cos(angle) * groupRadius;
      const centerY = height / 2 + Math.sin(angle) * groupRadius * 0.72;
      const subject = subjects.find((item) => item.id === graph.subjectId) ?? {
        id: graph.subjectId,
        name: graph.subjectId,
      };
      const color = subjectColor(subject as Subject);
      const localCount = Math.max(graph.nodes.length, 1);

      graph.nodes.forEach((node, nodeIndex) => {
        const localAngle = angle + (Math.PI * 2 * nodeIndex) / localCount;
        const localRadius = localCount === 1 ? 0 : 42 + Math.min(localCount * 9, 70);
        positions.push({
          node,
          x: centerX + Math.cos(localAngle) * localRadius,
          y: centerY + Math.sin(localAngle) * localRadius,
          color,
          subjectName: subject.name,
        });
      });
    });

    const byId = new Map(positions.map((item) => [item.node.id, item]));
    const lineSet = new Set<string>();
    const lines: Array<{ from: PositionedNode; to: PositionedNode }> = [];

    for (const graph of graphs) {
      for (const edge of graph.edges) {
        const from = byId.get(edge.fromSkillId);
        const to = byId.get(edge.toSkillId);
        if (!from || !to) continue;
        const key = `${from.node.id}:${to.node.id}`;
        if (lineSet.has(key)) continue;
        lineSet.add(key);
        lines.push({ from, to });
      }
      for (const node of graph.nodes) {
        for (const prerequisiteId of node.prerequisiteIds) {
          const from = byId.get(prerequisiteId);
          const to = byId.get(node.id);
          if (!from || !to) continue;
          const key = `${from.node.id}:${to.node.id}`;
          if (lineSet.has(key)) continue;
          lineSet.add(key);
          lines.push({ from, to });
        }
      }
    }

    return { nodes: positions, edges: lines };
  }, [graphs, subjects]);

  return (
    <div className="skill-graph-canvas" role="group" aria-label="스킬 관계 그래프">
      <svg viewBox="0 0 940 560" preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id="node-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(187,196,226,.35)" />
          </marker>
        </defs>
        <g className="graph-grid">
          {Array.from({ length: 12 }, (_, index) => (
            <line key={`v-${index}`} x1={index * 86} y1="0" x2={index * 86} y2="560" />
          ))}
          {Array.from({ length: 8 }, (_, index) => (
            <line key={`h-${index}`} x1="0" y1={index * 80} x2="940" y2={index * 80} />
          ))}
        </g>
        <g className="graph-edges">
          {edges.map(({ from, to }) => (
            <line
              key={`${from.node.id}-${to.node.id}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              markerEnd="url(#arrow)"
            />
          ))}
        </g>
        <g className="graph-nodes">
          {nodes.map(({ node, x, y, color, subjectName }) => {
            const selected = node.id === selectedSkillId;
            const radius = 9 + node.mastery * 11;
            return (
              <g
                key={node.id}
                className={selected ? "graph-node is-selected" : "graph-node"}
                transform={`translate(${x} ${y})`}
                onClick={() => onSelect(node)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") onSelect(node);
                }}
              >
                <circle
                  r={radius + 7}
                  fill={color}
                  opacity={0.06 + node.uncertainty * 0.1}
                  filter={selected ? "url(#node-glow)" : undefined}
                />
                <circle
                  r={radius}
                  fill={color}
                  opacity={0.35 + node.mastery * 0.65}
                  stroke={selected ? "#fff" : color}
                  strokeWidth={selected ? 2.5 : 1}
                />
                <text y={radius + 18} textAnchor="middle" className="graph-label">
                  {node.name}
                </text>
                <title>{`${subjectName} · 숙련도 ${Math.round(node.mastery * 100)}% · 불확실성 ${Math.round(node.uncertainty * 100)}%`}</title>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
