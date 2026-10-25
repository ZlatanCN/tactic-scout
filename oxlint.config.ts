import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import { jsPluginSettings, selectJsPlugins } from "ultracite/oxlint/js-plugins";
import react from "ultracite/oxlint/react";
import shadcn from "ultracite/oxlint/shadcn";
import vitest from "ultracite/oxlint/vitest";

const jsPlugins = selectJsPlugins([
  "github",
  "jsdoc-js",
  "sonarjs",
  "tsdoc",
  "react-doctor",
]);

export default defineConfig({
  env: core.env,
  extends: [core, vitest, react, shadcn, antiSlop, jsPlugins],
  ignorePatterns: [...core.ignorePatterns, "**/*.md", "**/*.mdx"],
  jsPlugins: [...jsPlugins.jsPlugins, ...shadcn.jsPlugins],
  options: { typeAware: true },
  rules: {
    "typescript/consistent-type-definitions": ["error", "type"],
  },
  settings: jsPluginSettings,
});
