# Audit of app (after the rescue)

High: 0  Medium: 1  Low: 0

- **MEDIUM** `raw-html` src/components/ui/chart.tsx:73: dangerouslySetInnerHTML renders raw HTML. Fine for trusted constants, an XSS hole for user or AI text.
