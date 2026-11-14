---
status: proposed
date: 2026-11-13
decision-makers: David Bustos Jr (PRD W0-2)
consulted: Forge
informed: Atlas, Davinci
---

# Enforce autonomy locally with Anthropic Sandbox Runtime (srt), with Docker and Gondolin as fallbacks

## Context and Problem Statement

R-AUTO says the sandbox, not the prompt, enforces autonomy, and Autonomous must refuse to start without it (R-AUTO-4). Pi itself runs with the user's permissions and has no permission system ([Pi security doc](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md)). MVP runs on the user's machine (PRD cut C4). David builds on Windows; users are on Windows, macOS and Linux.

## Decision Drivers

* Works on Windows, macOS and Linux without Docker Desktop
* Filesystem write limits and an egress allow-list
* Wraps both single commands and a whole process
* Open source, no cost

## Considered Options

* A. `srt` (`@anthropic-ai/sandbox-runtime`, Apache-2.0, 0.0.83)
* B. Docker container per session
* C. Pi's Gondolin micro-VM extension
* D. No sandbox; rely on the `tool_call` gate

## Decision Outcome

Proposed option: "A", because it is the only option covering all three operating systems natively: `sandbox-exec` on macOS, bubblewrap on Linux, and on Windows a dedicated `srt-sandbox` user with a Windows Filtering Platform egress filter and write-restricted token, with network access forced through local proxies ([srt README](https://github.com/anthropics/sandbox-runtime)). Profiles per preset are in ARCHITECTURE section 9. B is the fallback where `srt` fails, C an option for Linux and macOS users who want a VM boundary (Gondolin needs Node 23.6+ and QEMU, [Pi containerization doc](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/containerization.md)). D is rejected for Auto and Autonomous; the gate stays as UX and audit.

### Consequences

* Good, because no Docker install for most users.
* Bad, because `srt` is pre-1.0 and its README lists Windows limitations (for example, the egress filter does not follow a process that swaps tokens before creating a socket). Our escape suite must run on Windows specifically.
* Bad, because the Windows mode creates a local user account, which needs admin consent once; the extension must explain this.

### Confirmation

Sandbox escape suite (THREAT_MODEL T-05) passes on Windows, macOS and Linux in CI or a manual matrix before FUR: write outside workspace, read `~/.ssh`, egress to a non-allow-listed host, fork bomb, and symlink escape all fail. Revisit if any escape test fails without an upstream fix within two weeks.

## More Information

PRD R-AUTO-4, W0-2, Q5, cut C4. Related: ADR-0001, ADR-0004.
