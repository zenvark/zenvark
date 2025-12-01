# Changesets

This folder contains changeset files that describe changes to the packages in this monorepo.

## How to use changesets

When you make changes to packages, create a changeset to describe them:

```bash
npm run changeset
```

This will prompt you to:

1. Select which packages have changes
2. Choose the semver bump type (major, minor, or patch)
3. Write a summary of the changes

The changeset will be committed along with your code changes.

## Version Bumping

All packages are **fixed** together, meaning:
- When you bump ANY package, ALL packages will receive the same version bump
- All packages will always have the same version number
- This ensures consistency across the entire monorepo

## Automated Releases

The GitHub Actions workflow automatically:

- Creates a release PR when changesets are pushed to main
- Publishes packages when the release PR is merged
- Creates GitHub releases with release notes
