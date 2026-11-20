# Contributing

Thanks for helping with Meetings Plus.

## Build, lint, test

```bash
npm install
npm run build   # type-check and bundle main.js
npm run lint    # eslint with the Obsidian plugin rules
npm test        # unit tests (Node's built-in test runner)
```

`npm run dev` rebuilds `main.js` on every change. To try it, copy `main.js`, `manifest.json` and `styles.css` to `<vault>/.obsidian/plugins/meetings-plus/` and reload Obsidian.

Keep `src/` free of Node APIs (`fs`, `require`) so the plugin runs on mobile and passes the community directory checks.

## Pull requests

- Open pull requests against `main`.
- Build, lint and tests should pass.
- Plain commit messages: one line saying what changed, a short body if it needs one.
