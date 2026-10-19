import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // Every screen lives under one catch-all route (app/[[...slug]]) and is
    // switched in client state with go(). The few internal <a> links and the
    // reload after signing in or out leave that state on purpose (sample
    // workspace <-> live ledger, the setup guide, the platform sign-in): a full
    // document load guarantees that sample data and the live ledger never share
    // a client instance and that the ledger is read again from the server.
    // next/link and router.push() would keep the client state.
    files: ["app/**/*.tsx", "components/rentledger/**/*.tsx"],
    rules: {
      "@next/next/no-html-link-for-pages": "off",
      "@next/next/no-location-assign-relative-destination": "off",
    },
  },
  {
    files: ["components/ui/**/*.{ts,tsx}", "hooks/use-mobile.ts"],
    rules: {
      // These files are vendored verbatim from shadcn@4.17.0. Keep the
      // registry source intact while applying the stricter rules to Site code.
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
