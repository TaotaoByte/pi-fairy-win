import { buildHelper } from "../src/desktop/client.ts";

// Explicit compile-only preparation: never launch a helper or acquire a lease.
console.log(await buildHelper());
console.log(await buildHelper("Startup"));
