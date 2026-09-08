# Opt-in template: source this file explicitly; no startup files are edited.
# `command pi ...` bypasses this function. `unfunction pi` removes it.
# Resolve this package when sourced, never a versioned external Pi installation.
typeset -g FAIRY_STARTUP_PACKAGE="${${(%):-%x}:A:h:h:h:h}"
function pi() {
  if (( $# != 0 )) || [[ ! -t 0 || ! -t 1 || ! -t 2 || -n ${PI_SUBAGENT_CHILD+x} || -n ${PI_CODING_AGENT_DIR+x} || -n ${PI_PACKAGE_DIR+x} || -n ${NODE_OPTIONS+x} ]]; then
    command pi "$@"
    return $?
  fi
  local external="$(whence -p pi)"
  local -a cached
  cached=("${(@f)$(command node --experimental-strip-types "$FAIRY_STARTUP_PACKAGE/modules/animation/scripts/startup-cache.ts" 2>/dev/null)}")
  if [[ -n $external && ${#cached} == 2 && -x ${cached[1]} && -x ${cached[2]} ]]; then
    command "${cached[1]}" "$external" "$FAIRY_STARTUP_PACKAGE" "${cached[2]}"
  else
    command pi "$@"
  fi
}
