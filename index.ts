import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import animation from "./modules/animation/src/index.ts";
import { consumeStartupLease } from "./modules/animation/src/desktop/client.ts";
import { fileURLToPath } from "node:url";
import voice from "./modules/voice/fairy.ts";

/** Desktop lifecycle audio and rest reminders are shared; other voice stays per Pi. */
export default function fairy(pi: ExtensionAPI) {
	animation(pi, { startupLease: consumeStartupLease(), lifecycleSoundsDirectory: fileURLToPath(new URL("./modules/voice/sounds/", import.meta.url)) });
	voice(pi, { automaticLifecycleCues: false, processMute: true, activityReminders: false });
}
