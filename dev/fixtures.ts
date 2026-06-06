export const fixtures: Record<string, string> = {
  flowchart: 'graph TD\n  A[Start] --> B{Works?}\n  B -->|yes| C[Ship]\n  B -->|no| D[Fix]\n  D --> B',
  sequence: 'sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi',
  er: 'erDiagram\n  USER ||--o{ NOTE : writes\n  NOTE }o--|| PAGE : on',
  mindmap: 'mindmap\n  root((plugin))\n    core\n    viewer\n    adapter',
  'html-labels': 'graph LR\n  A["<b>bold</b> label"] --> B',
  broken: 'graph TD\n  A --> --> B',
}
