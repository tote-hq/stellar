#!/usr/bin/env bash
# Print one admin password_hash. The password is read silently, is not an
# argument, and is not written to the shell history.
set +o history
set +x
unset HISTFILE
IFS= read -rs -p 'Clave: ' password || exit 1
printf '\n' >&2
printf '%s' "$password" | node --experimental-strip-types "$(dirname "$0")/../apps/web/scripts/admin-password-hash.ts"
status=$?
unset password
exit "$status"
