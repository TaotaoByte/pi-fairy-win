import { access, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { cachedNativePath } from "../src/desktop/client.ts";

// Read-only resolver for the opt-in shell function. Never compile or launch.
try {
 if (process.platform !== "darwin") process.exit(1);
 const directory = `/tmp/pi-fairy-${process.getuid!()}`;
 const stat = await lstat(directory);
 if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid!() || (stat.mode & 0o077)) process.exit(1);
 const paths = await Promise.all([cachedNativePath("Startup", directory), cachedNativePath("Fairy", directory)]);
 for (const path of paths) await access(path, constants.X_OK);
 console.log(paths.join("\n"));
} catch { process.exitCode = 1; }
