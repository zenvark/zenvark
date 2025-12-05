# Zenvark Documentation

This documentation site is built using [Docusaurus](https://docusaurus.io/), a modern static website generator.

## Local Development

From this directory (`apps/docs`):

```bash
npm start
```

This command starts a local development server and opens up a browser window. Most changes are reflected live without having to restart the server.

## Build

From this directory:

```bash
npm run build
```

This command generates static content into the `build` directory and can be served using any static contents hosting service.

## Serve Built Site Locally

After building, you can preview the production build:

```bash
npm run serve
```

## Deployment

The documentation is automatically deployed to GitHub Pages when changes are pushed to the `main` branch. The deployment is handled by GitHub Actions (see `.github/workflows/deploy-docs.yml`).

The live documentation is available at: https://zenvark.github.io/zenvark/

## Editing Documentation

1. Navigate to the `docs/` directory
2. Edit or create markdown files
3. The dev server will auto-reload with your changes

For more information, see the [Docusaurus documentation](https://docusaurus.io/docs).
