# Opt-in startup entry

This is a separate, removable **zsh function**, not a replacement Pi executable,
host patch, global setting, launcher daemon or install hook. The ordinary plugin
still starts at `session_start`, after Pi has started its TUI. Only the narrow
supported entry below can obtain Fairy's software-ready acknowledgement before
exec'ing Pi. Physical WindowServer presentation is not certified.

## Explicit preparation and activation

1. Review this change and release all old desktop leases normally before trying
   a new shared helper lifetime. Do not delete/kill a leased helper.
2. In this package, run `npm run prepare:desktop` explicitly. This compiles the
   two source/architecture-hashed native executables in the existing private
   `/tmp/pi-fairy-UID` cache. It does not launch anything or acquire a lease.
   System restart/cleanup may remove this temporary cache. The shell function
   remains installed, but early entry falls back to ordinary Pi until preparation
   is repeated; no automatic compiler hook is added.
3. Only the user may opt in by sourcing
   `modules/animation/scripts/startup.zsh` in an interactive zsh. No shell startup
   file is edited automatically. Persisting that source line is a separate user
   decision. Do not source over another custom `pi` function/alias without review.
4. `command pi ...` always bypasses this function. `unfunction pi` removes it
   from the current shell; remove any personally added source line to roll back.

The function resolves the external `pi` through the shell's **current PATH on
every invocation**. No nvm version path is stored. Pi upgrades do not overwrite
this package/function, nor require applying a host patch. The launcher recognizes
the external package's declared `bin.pi` and package name using read-only JSON;
unrecognized wrappers/layouts delegate normally. A future incompatible public
configuration/protocol change may require reviewing this optional entry, not
patching Pi. No blanket future-version compatibility guarantee is made.

## Narrow supported invocation

Only bare, foreground interactive `pi`, with stdin/stdout/stderr all TTYs, on
macOS, with both exact native binaries already cached. Every argument, including
help/version/admin/update/export, RPC/print, `-ne`, backend flags and unknown
arguments, bypasses preflight unchanged. NonTTY, subagent, agent-dir/package-dir
override and NODE_OPTIONS invocations also bypass it. It does not parse Pi CLI.

The native guard reads JSON, without loading extensions, importing Pi internals,
locking/writing settings, network calls or resource installation:

- Global `packages` must contain the local integrated root exactly once as an
  unfiltered string. Relative paths resolve against `~/.pi/agent`, like Pi.
  Package object/filter forms and global `extensions` overrides are conservative
  fallback. Other string package entries remain Pi's responsibility.
- The root manifest must still register exactly `./index.ts`.
- Project `packages/extensions/skills/prompts/themes` lists must be absent/empty,
  and there must be no actual project `.pi/extensions`, `skills`, `prompts`,
  `themes`, or ancestor project `.agents/skills` directory. A `.pi/npm` cache and
  `{ "packages": [] }` alone are neutral, not a reason to disable early entry.
- Ordinary model/theme/changelog changes are irrelevant. No whole-settings hash
  or renewed authorization is required. Restoring a recognized activation state
  automatically restores eligibility. Malformed/ambiguous relevant configuration
  falls through to Pi; Pi remains the authoritative full resource resolver.

The guard is conservative, not a full Pi resource resolver. Other extensions can still fail; readiness is not proof of successful registration.

## Ready, handoff and failure semantics

The launcher does not compile. Missing cache/unsupported configuration delegates
immediately. It connects only in the existing private UID-owned directory. A
missing socket may start the cached helper through a short-lived mode of the
same launcher and a detached POSIX spawn; an
existing/inaccessible socket is never deleted, replaced or force-upgraded.
The direct trampoline child is reaped before Pi exec; the helper is reparented
to the system, not left as an unregistered child of Node. An alive-Node private
regression found a zombie with direct spawn; this bounded extra hop corrects it.
The trampoline can only spawn and exit; it is not a daemon. Its wait shares the
1.5s budget, and timeout kills/reaps only that owned unleased trampoline, never
a helper. Foreground interruption during this hop does not launch a proxy Pi.
Socket/ready waiting is bounded to 1.5 seconds; compile cost is outside normal
launch because preparation is explicit.

`prelude FAIRY2 <UUID>` is an optional new hello. Old helpers reject it **without
qualifying a lease**, so ordinary Pi startup remains available. The integrated
helper reads the saved full/simple mode after acquiring its flock, qualifies a
provisional lease, and starts the once-per-shared-lifetime entrance. It responds
`FAIRY2 ready <UUID>` after ordering/drawing/flushing the full cover or simple's
visible initial transparent Fairy. Simple does not wait for a nonexistent cover. The old `lease FAIRY2` greeting is unchanged and is not readiness proof.
A helper already presenting/finished its opening acknowledges the existing
lifetime without replay. An animation-only/retiring/incompatible owner falls back.

The launcher then `execv`s the resolved Pi in the same process, foreground process
group and terminal, with original stdio. There is no child-Pi proxy or signal
forwarding layer. One inherited socket fd and token span the transition. The
integrated factory only consumes/deletes the two metadata environment fields;
it starts no resource. Its eligible desktop session handler adopts the same fd
and exchanges `claim <UUID>` / `FAIRY2 claimed <UUID>` before normal socket use.
There is no deliberate zero-lease handoff gap or duplicate lease connection.
Each caller has its own fd/token; one starter cannot release another's lease.

A provisional peer expires after **15 seconds from native acceptance** unless
claimed. EOF, failed exec, invalid claim and ordinary Pi exit also release it.
Claimed peers use the unchanged shared lifetime/grace. Startup slower than this
budget or a disabled/failed plugin can lose the prelude and fall back to ordinary
plugin startup; the intro is never replayed inside that helper lifetime. Failures
after cover creation can cancel it on the next native tick. This is not a promise
of uninterrupted cinema across failed starts or arbitrary OS suspension.

Keyboard focus is never stolen; typing/Ctrl-C/Ctrl-Z retain terminal/job-control
semantics. Full's cover still absorbs pointer input, has no SKIP action, and
retains accepted 10s visuals/SFX/welcome7. Simple is mouse-passthrough, uses
welcome1–6 without SFX, and reaches the same saved position. Both use the same
local goodbye; neither adds a shell hook or changes eligibility. Readiness
means software ordering/drawing, **not a measurement of physical first pixels**.

## Publication candidate boundary

No shell activation is included. Select a reviewed local checkout path explicitly if opting in. A Git URL settings entry does not meet the local-path guard above; ordinary Git installation and this optional entry are separate configurations. Never automatically replace URL settings with a local checkout. All 44 voice WAVs are bundled; resource integrity does not certify physical audio or desktop presentation.

## Isolated verification

`python3 modules/animation/tests/startup-entry.py` compiles private fixtures from
production sources, substitutes only private ownership roots, and uses a real
headless helper plus fake Pi executables/PTYs. It never accesses a user's helper,
preferences/cache, draws visible windows or plays audio. Tests cover native
ready/claim, inherited-fd ownership, expiry, conservative guards, ordinary argument
fallback, PATH changes, terminal signals/job control, bounded trampoline failure/
interruption, and helper reaping while the claimed Node Pi remains alive. Source-level/offscreen
checks cover the actual cover draw-before-ready pipeline separately. A headless
ready acknowledgement/PTY first byte is not physical compositor evidence.

Historical six-second display/missing-welcome exit failures remain UNKNOWN,
owner-deferred, unchanged and excluded from this validation. Any further real
desktop trial remains user-controlled; package installation never activates the
shell entry automatically.

Both early and ordinary integrated launches explicitly enable the shared desktop
[rest reminder](REST-REMINDER.md) with the same local sounds directory. Prelude
qualification does not start its clock: actual first visible pet does. No new
startup guard, shell configuration, saved setting or readiness delay is added.
