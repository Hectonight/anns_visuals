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
