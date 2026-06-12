#!/usr/bin/env bash

local_redis_require_simple_password() {
  local key="${1:?redis password key is required}"
  local value="${2:-}"
  local prefix="${3:-[local-redis]}"
  if [[ -z "${value}" || ! "${value}" =~ ^[A-Za-z0-9_.-]+$ ]]; then
    echo "${prefix} ERROR: ${key} local Redis password must be URL-safe/simple ([A-Za-z0-9_.-]+)" >&2
    return 1
  fi
}

local_redis_auth_ping() {
  local host="${1:?redis host is required}"
  local port="${2:?redis port is required}"
  local password="${3:?redis password is required}"
  local prefix="${4:-[local-redis]}"
  local timeout="${5:-1.5}"
  local_redis_require_simple_password REDIS_PASSWORD "${password}" "${prefix}" || return 1
  python3 - "${host}" "${port}" "${password}" "${timeout}" <<'PY'
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])
password = sys.argv[3]
timeout = float(sys.argv[4])

def encode_command(*parts: str) -> bytes:
    payload = f"*{len(parts)}\r\n".encode()
    for part in parts:
        data = part.encode()
        payload += f"${len(data)}\r\n".encode() + data + b"\r\n"
    return payload

def read_reply(sock: socket.socket) -> bytes:
    data = b""
    while b"\r\n" not in data and len(data) < 4096:
        chunk = sock.recv(4096)
        if not chunk:
            break
        data += chunk
    return data

try:
    with socket.create_connection((host, port), timeout=timeout) as sock:
        sock.settimeout(timeout)
        sock.sendall(encode_command("AUTH", password))
        if not read_reply(sock).startswith(b"+OK"):
            sys.exit(1)
        sock.sendall(encode_command("PING"))
        if not read_reply(sock).startswith(b"+PONG"):
            sys.exit(1)
except (OSError, ValueError):
    sys.exit(1)
PY
}
