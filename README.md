# Voxel Character Studio

Web-based 3D voxel editor for pixel-art-style characters and game assets, built with React, TypeScript, Three.js, Tailwind CSS and Zustand.

## Run

```
npm install
npm run dev      # development server
npm run build    # type-check and production build
npm test         # unit tests
```

## Deployment

The GitHub Actions workflow deploys the site to GitHub Pages whenever changes
are pushed to `main`. It can also be started manually from the Actions tab.
In the repository's Settings > Pages, set the build and deployment source to
**GitHub Actions**. The workflow tests and builds the app before deploying it.

## Features

- Orbit/pan/zoom viewport, perspective or orthographic camera, adjustable grid, background and lighting
- Draw, erase, paint, pick, fill, line, box, sphere, select, move, rotate and flip, copy/paste, undo/redo
- X/Y/Z symmetry with live mirrored editing
- Character templates (humanoid, animal, monster, robot, blank) with proportion sliders
- Layers with groups, visibility, locking, renaming and opacity preview
- Palettes: retro presets, custom palettes, import/export (JSON, GPL, HEX), global color replace, color reduction
- Animation: keyframes per layer, frame snapshots, walk/idle/attack templates, preview window
- Asset library with built-in and user-saved parts
- Export: VOX, OBJ+MTL, GLB/GLTF (optional auto-rig and animations), STL, PNG sprite sheets (front/side/back/isometric), GIF
- Project files (`.vcs`) and auto-save every 30 seconds to the browser

FBX is not supported (no reliable browser exporter); use GLB/GLTF instead.

## Controls

| Action | Input |
| --- | --- |
| Orbit | Right mouse, or Alt + left mouse |
| Pan | Middle mouse, or Shift + right mouse |
| Zoom | Mouse wheel |
| Tools | D E P I F L B O S M R T |
| Symmetry | Shift + X / Y / Z |
| Undo / Redo | Ctrl+Z / Ctrl+Y |

Drawing happens on the face under the cursor and stays on that plane while dragging.

## Layout

- `src/core` voxel grid, edit batches, history, shapes, transforms, colors
- `src/store` Zustand stores (project, editor, view)
- `src/viewport` Three.js engine, chunk mesher, picking, overlays, animation stage
- `src/tools` pointer tool controller and selection/transform actions
- `src/templates`, `src/anim`, `src/assets` characters, animation poses, asset library
- `src/io` project files, autosave, exporters, sprites, rigging
- `src/ui` panels and dialogs
