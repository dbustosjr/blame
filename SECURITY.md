# Security policy

Blame runs an AI agent on your machine with your own model API key, so we take security reports seriously.

## Reporting a vulnerability

Please report security issues privately through GitHub's [private vulnerability reporting](https://github.com/dbustosjr/blame/security/advisories/new). Don't open a public issue, pull request or discussion for a security problem.

A useful report includes:

- What you found and where (file, command, or feature)
- Steps to reproduce it, or a small proof of concept
- What an attacker could do with it
- The Blame version or commit you tested

We aim to acknowledge reports within 3 business days and to share a plan or fix timeline within 10 business days. We'll keep you updated and credit you in the advisory unless you'd rather stay anonymous.

## Supported versions

Blame is in early development and hasn't had a stable release yet. Security fixes land on the `main` branch. Once releases start, the latest release will receive fixes.

## What's in scope

- The Blame core engine, CLI and VS Code extension in this repository
- How Blame handles API keys, secret files, approvals and the autonomy presets
- The GitHub Action reviewer and the website in this repository

Problems in third-party services or model providers are out of scope here. Please report those to the provider directly. Issues in Pi, the engine Blame is built on, belong with the [Pi project](https://github.com/earendil-works/pi).

## Please don't

- Access, change or delete data that isn't yours
- Run tests that degrade service for other people
- Share details publicly before a fix is available

For how Blame is designed to handle threats such as prompt injection, key leaks and sandbox escapes, see [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).
