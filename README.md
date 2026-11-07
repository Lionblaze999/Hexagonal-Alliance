# Hexagonal Alliance

[Play Hexagonal Alliance](https://lionblaze999.github.io/Hexagonal-Alliance/)

A minimalist 20 × 20 hex strategy game. Choose a country, then spend one point to attack a rival within two hexes, move your commander, or give a point to a nearby country. Unspent points carry over. A new point arrives at 5 PM local time each day. The last country with territory wins.

The game runs as a static page and saves its world in the current browser. Rival countries are simulated locally; GitHub Pages does not provide the shared server state needed for internet multiplayer.

The Pages workflow deploys `index.html` on pushes to `main`. In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions** if it is not already configured.
