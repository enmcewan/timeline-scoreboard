# Timeline Football

**Timeline Football** is a high-performance, SEO-first web application that presents football (soccer) matches as **event-by-event timelines** rather than traditional box scores.

The project currently covers the **English Premier League 2025–26 season**, with a foundation designed to scale across leagues, seasons, and competitions.

Live site: https://timelinefootball.com

---

## What Makes This Different

Most football sites focus on scores, tables, or commentary. Timeline Football focuses on **time**.

Each matchweek is rendered as a chronological sequence of:
- goals
- cards
- substitutions
- VAR decisions
- match state changes

This allows users (and search engines) to understand **how matches unfolded**, not just how they ended.

---

## Technical Goals

This project was built with the following constraints and priorities:

- **SEO-first rendering** (no JS-only pages)
- **Fast static delivery** with zero runtime servers
- **Deterministic builds** and deploys
- **Minimal client-side JS**
- **Clear separation of build-time vs runtime responsibilities**
- **Future scalability** across leagues and seasons

---

## Architecture Overview

### Rendering Model

- **Static prerendering** for all matchweek and season hub pages  
- **Client-side enhancement** after load for interactivity  
- No frontend framework (vanilla JS by design)

This avoids the SEO and hydration complexity common in large SPA frameworks while keeping interaction fast and predictable.

---

### Build & Data Flow

- Match data is sourced from an external football data API
- Data refreshes are handled via **GitHub Actions**
- A “smart refresh gate” prevents unnecessary rebuilds
- Prerendered HTML is generated at build time
- Netlify serves the final static output only (no build step on Netlify)

**Important:**  
Generated data is **not committed to Git**. GitHub Actions fetches data, builds, and deploys in one controlled pipeline.

---

### Deployment Strategy

- GitHub Actions performs:
  - data refresh
  - prerender build
  - production deploy
- Netlify acts purely as a static host

This avoids double-build issues and ensures that what is built is exactly what is deployed.

---

## SEO & Metadata

Each prerendered page includes:

- Semantic HTML
- Canonical URLs
- Structured data (JSON-LD):
  - `ItemList` for matchweeks
  - `SportsEvent` for individual matches
  - `SportsTeam` entities
- Open Graph metadata
- Twitter Card metadata

All metadata is injected at **build time**, not runtime, ensuring correct indexing and social sharing previews.

---

## Branding & Presentation

The brand identity is intentionally restrained and editorial:

- Clean, minimal visual language
- Timeline motif carried throughout the UI
- Subtle “88’” design cue to reflect match narrative peaks
- Icon-only avatar and favicon for clarity at small sizes
- OG images designed for instant recognition in social feeds

---

## Tech Stack

- **Build tooling:** Vite
- **Frontend:** Vanilla JavaScript
- **Styling:** Custom CSS
- **Hosting:** Netlify (static only)
- **CI/CD:** GitHub Actions
- **Data:** External football API
- **SEO:** JSON-LD + prerendered HTML

No React, Vue, or heavy frameworks were used intentionally to reduce complexity and improve long-term maintainability.

---

## Project Status

- EPL 2025–26: **Live**
- Core architecture: **Complete**
- Branding & SEO: **Complete**
- Additional leagues: **Planned**
- Advanced OG automation (per matchweek images): **Planned**

---

## Why This Project Exists

Timeline Football is both:
- a **production-quality application**, and
- a **demonstration of architectural decision-making**

It emphasizes:
- choosing the right level of complexity
- understanding crawler behavior vs browser behavior
- separating concerns cleanly
- building systems that age well

---

## Contact

If you’re viewing this as part of a professional review or discussion, feel free to reach out via GitHub or through the contact information on the live site.

---

*Timeline Football — because matches are stories, not just scores.*
