export const fixtures: Record<string, string> = {
  flowchart: 'graph TD\n  A[Start] --> B{Works?}\n  B -->|yes| C[Ship]\n  B -->|no| D[Fix]\n  D --> B',
  sequence: 'sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi',
  er: 'erDiagram\n  USER ||--o{ NOTE : writes\n  NOTE }o--|| PAGE : on',
  mindmap: 'mindmap\n  root((plugin))\n    core\n    viewer\n    adapter',
  'html-labels': 'graph LR\n  A["<b>bold</b> label"] --> B',
  'fa-icons':
    'flowchart TD\n  B["fab:fa-github for code"]\n  B-->C[fa:fa-ban forbidden]\n  B-->D(fa:fa-spinner)\n  B-->E(A far:fa-bell perhaps?)',
  broken: 'graph TD\n  A --> --> B',
}
