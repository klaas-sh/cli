# Nexo Dashboard

Web dashboard for remote access and control of Claude Code sessions.

## Development

```bash
# From project root
yarn dev:dashboard

# Or directly
cd packages/dashboard && yarn dev
```

## Theme Colors

The dashboard uses a semantic color system defined in `src/app/globals.css`.
All colors are based on Tailwind's violet palette.

### Color Reference

| Semantic Name | Light Tailwind | Light Hex | Dark Tailwind | Dark Hex |
|--------------|----------------|-----------|---------------|----------|
| `app-primary` | violet-600 | `#7c3aed` | violet-400 | `#a78bfa` |
| `app-primary-hover` | violet-700 | `#6d28d9` | violet-500 | `#8b5cf6` |
| `app-primary-light` | violet-100 | `#ede9fe` | violet-900 | `#4c1d95` |
| `app-secondary` | slate-500 | `#64748b` | slate-500 | `#64748b` |
| `app-accent` | violet-800 | `#5b21b6` | violet-600 | `#7c3aed` |
| `app-success` | emerald-500 | `#10b981` | emerald-400 | `#34d399` |
| `app-warning` | amber-500 | `#f59e0b` | amber-400 | `#fbbf24` |
| `app-error` | red-500 | `#ef4444` | red-400 | `#f87171` |
| `app-background` | violet-50 | `#faf5ff` | violet-950 | `#2e1065` |
| `app-surface` | white | `#ffffff` | violet-900 | `#4c1d95` |
| `app-border` | violet-200 | `#ddd6fe` | violet-700 | `#6d28d9` |
| `app-highlight` | violet-50 | `#f5f3ff` | ~violet-900/50 | `#3b1a6d` |
| `app-text-primary` | slate-800 | `#1e293b` | violet-100 | `#ede9fe` |
| `app-text-secondary` | violet-700 | `#6d28d9` | violet-300 | `#c4b5fd` |
| `app-text-muted` | slate-500 | `#64748b` | violet-400 | `#a78bfa` |

### Logo Colors

The favicon and AppIcon use these colors:

| Element | Tailwind | Hex |
|---------|----------|-----|
| Background | violet-900 | `#4c1d95` |
| Title bar | violet-600 | `#7c3aed` |
| Terminal elements | violet-100 | `#ede9fe` |

### Usage

Use the semantic Tailwind classes in components:

```tsx
// Primary button
<button className="bg-app-primary hover:bg-app-primary-hover text-white">

// With dark mode
<div className="bg-app-surface dark:bg-app-surface-dark">

// Text colors
<p className="text-app-text-primary dark:text-app-text-primary-dark">
```

To change the color scheme, update the CSS variables in `globals.css`.
