import { buildHelper } from "../src/desktop/client.ts";

// Explicit compile-only preparation: never launch a helper or acquire a lease.
console.log(await buildHelper());
// The startup prelude helper is macOS/zsh-only; skip it on Windows.
if (process.platform === "darwin") console.log(await buildHelper("Startup"));
