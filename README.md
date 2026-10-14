# Cat Jam Notes

Minimalist, Obsidian-style markdown notebook. Works on desktop and mobile (responsive web app). Optional: use a real local folder as a "vault" (File System Access API supported browsers).

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Build

```bash
npm run build
npm run preview
```

## Features

- Markdown editing with split/edit/preview modes
- Wiki links `[[Note]]` and backlinks panel
- Outgoing links & tags
- Command palette (`Ctrl+P`), quick open (`Ctrl+O`), new note (`Ctrl+N`)
- Daily notes and templates
- Graph view
- 5 themes (minimal light/dark, sepia, ocean, nord)
- Local-first storage (IndexedDB)
- Optional local folder vault via "Vault" button
- Installable as PWA (manifest)
