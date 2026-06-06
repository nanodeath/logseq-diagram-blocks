- **flowchart**
	- ```mermaid
	  graph TD
	    A[Start] --> B{Works?}
	    B -->|yes| C[Ship]
	    B -->|no| D[Fix]
	    D --> B
	  ```
- **sequence**
	- ```mermaid
	  sequenceDiagram
	    Alice->>Bob: Hello
	    Bob-->>Alice: Hi
	  ```
- **er**
	- ```mermaid
	  erDiagram
	    USER ||--o{ NOTE : writes
	    NOTE }o--|| PAGE : on
	  ```
- **mindmap**
	- ```mermaid
	  mindmap
	    root((plugin))
	      core
	      viewer
	      adapter
	  ```
- **html-labels**
	- ```mermaid
	  graph LR
	    A["<b>bold</b> label"] --> B
	  ```
- **fa-icons**
	- ```mermaid
	  flowchart TD
	    B["fab:fa-github for code"]
	    B-->C[fa:fa-ban forbidden]
	    B-->D(fa:fa-spinner)
	    B-->E(A far:fa-bell perhaps?)
	  ```
- **broken**
	- ```mermaid
	  graph TD
	    A --> --> B
	  ```
