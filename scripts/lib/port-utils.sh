#!/usr/bin/env bash

port_is_listening() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1 && lsof -iTCP:"${port}" -sTCP:LISTEN -Pn >/dev/null 2>&1; then
    return 0
  fi
  if command -v ss >/dev/null 2>&1; then
    if ss -H -ltn "sport = :${port}" 2>/dev/null | grep -q .; then
      return 0
    fi
  fi
  if command -v fuser >/dev/null 2>&1 && fuser -n tcp "${port}" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

port_is_bindable() {
  local port="$1"
  if command -v python3 >/dev/null 2>&1; then
    python3 - "${port}" <<'PY'
import errno
import socket
import sys

port = int(sys.argv[1])

def try_bind(family, address):
    sock = socket.socket(family, socket.SOCK_STREAM)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        if family == socket.AF_INET6:
            try:
                sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
            except OSError:
                pass
        sock.bind(address)
        return True
    except OSError as exc:
        if exc.errno == errno.EADDRINUSE:
            return False
        return None
    finally:
        sock.close()

ipv6_result = try_bind(socket.AF_INET6, ("::", port))
if ipv6_result is False:
    sys.exit(1)
if ipv6_result is True:
    sys.exit(0)

ipv4_result = try_bind(socket.AF_INET, ("0.0.0.0", port))
if ipv4_result is False:
    sys.exit(1)
sys.exit(0)
PY
    return $?
  fi

  if port_is_listening "${port}"; then
    return 1
  fi
  return 0
}

port_pick_free() {
  local preferred_port="$1"
  local start_port="${2:-3010}"
  local end_port="${3:-3099}"
  local candidate

  if port_is_bindable "${preferred_port}"; then
    printf '%s\n' "${preferred_port}"
    return 0
  fi

  for candidate in $(seq "${start_port}" "${end_port}"); do
    if port_is_bindable "${candidate}"; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  return 1
}

port_wait_for_release() {
  local port="$1"
  local timeout_seconds="${2:-10}"
  local i

  for i in $(seq 1 "${timeout_seconds}"); do
    if ! port_is_listening "${port}"; then
      return 0
    fi
    sleep 1
  done

  return 1
}
