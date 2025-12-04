# Zenvark Documentation

This documentation site is built using [Docusaurus](https://docusaurus.io/), a modern static website generator.

## Local Development

From the project root:

```bash
npm run docs:dev
```

Or from this directory:

```bash
npm start
```

This command starts a local development server and opens up a browser window. Most changes are reflected live without having to restart the server.

## Build

From the project root:

```bash
npm run docs:build
```

Or from this directory:

```bash
npm run build
```

This command generates static content into the `build` directory and can be served using any static contents hosting service.

## Deployment

The documentation is automatically deployed to GitHub Pages when changes are pushed to the `main` branch. The deployment is handled by GitHub Actions (see `.github/workflows/deploy-docs.yml`).

The live documentation is available at: https://zenvark.github.io/zenvark/
