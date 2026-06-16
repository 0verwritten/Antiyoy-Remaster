# Antiyoy Web Remaster

This directory contains the Lakebed capsule for the browser remaster.

Run locally:

```sh
npx lakebed dev
```

Build the anonymous artifact:

```sh
npx lakebed build . --target anonymous
```

Run gameplay regression checks from the repository root:

```sh
cd devtools
npm run sim
```

Deploy:

```sh
npx lakebed deploy
```

Do not commit generated `.lakebed/` output. The root `.gitignore` and this
directory's `.gitignore` both ignore Lakebed build/cache directories.
