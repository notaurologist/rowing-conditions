# 0005: React, Vite, and visx for the web app

Status: Accepted (October 2026)

## Context
The owner is strongest in React and TypeScript. Server rendering adds little for this app. The 48-hour timeline chart is the core of the product and needs custom layering (darkness shading, highlighted windows, multiple metrics). The owner wants to grow data visualization skills.

## Decision
React single-page app built with Vite. visx for charts. TanStack Query for server state.

## Consequences
- Full control over the timeline chart and real D3 experience.
- More work than an off-the-shelf chart library; visx has a smaller community and has had slower maintenance at times. Observable Plot or Recharts are fallbacks.
