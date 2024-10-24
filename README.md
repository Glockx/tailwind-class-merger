# Tailwind Class Extractor

Extracts and organizes Tailwind CSS classes in className attributes, improving readability and maintainability of your React components.

## Features

- Automatic Extraction: Automatically extracts mobile or tablet media classes from className attributes and reorganizes them.
- Integration with twJoin: Wraps extracted classes with the twJoin function from the tailwind-merge library.
- Import Management: Automatically imports twJoin from tailwind-merge if it's not already imported.
- Selection-Based Formatting: Formats only the selected code or the entire document if no selection is made.
- Supports Various className Formats: Handles className attributes assigned to string literals, JSX expressions, and existing twJoin calls.
