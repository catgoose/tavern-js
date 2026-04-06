# tavern-js

Client-side companion for the [tavern](https://github.com/catgoose/tavern) SSE pub/sub engine.

## Development

- `npm run lint` — oxlint
- `npm test` — vitest
- `npm run build` — esbuild minify to dist/
- `npm run check` — lint + test + build

## Conventions

- All JavaScript uses JSDoc — every function, parameter, return value documented
- No frameworks, bundlers, or transpilers for the source — `src/tavern.js` is served as-is
- esbuild only for minification to `dist/tavern.min.js`
- oxlint for linting (not ESLint)
- vitest + jsdom for testing
