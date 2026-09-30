# ANNS Visualizers

Interactive, dependency-free visual explanations of approximate nearest-neighbor search algorithms.

## Visualizers

- **PiPNN** — complete index-construction pipeline
- **Randomized Ball Carving** — overlapping partition construction
- **HashPrune 2D** — residualized hashing on a plane
- **HashPrune 3D** — directional pruning in three dimensions
- **RobustPrune** — geometric graph-neighborhood pruning

## Run locally

The site has no build step. Serve the repository root with any static file server, for example:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Deploy to GitHub Pages

1. Create an empty GitHub repository and push this folder to its `main` branch.
2. Open **Settings → Pages** in the repository.
3. Set **Source** to **GitHub Actions**.
4. The included Pages workflow deploys the site after every push to `main`.

No package installation, compilation, or generated `dist` directory is required.

## Project structure

```text
.
├── index.html                 # Project landing page
├── visualizers/              # Interactive visualizer pages
├── assets/
│   ├── css/                  # Shared and page-specific styles
│   ├── js/                   # Page-specific behavior
│   └── images/               # Reference images
├── reference/                # Source material used to create figures
└── .github/workflows/        # GitHub Pages deployment
```
