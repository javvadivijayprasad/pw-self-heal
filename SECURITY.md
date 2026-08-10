# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 1.x | ✅ |
| < 1.0 | ❌ |

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Report privately using GitHub's
[**Report a vulnerability**](https://github.com/javvadivijayprasad/pw-self-heal/security/advisories/new)
flow (Security tab → Advisories), or email **jvijayprasad@gmail.com** with the
details and a reproduction if possible.

You can expect an acknowledgement within a few days. Once the issue is confirmed
and fixed, a patched release will be published and the reporter credited (unless
you prefer to remain anonymous).

## Scope notes

`pw-self-heal` runs **in-process** and, in its default mode, makes no network
calls and requires no API key — the DOM never leaves the machine. The optional
`onnxruntime-node` dependency runs the model locally. If a future release adds an
optional LLM fallback, it will be off by default and route data through an
in-process sanitizer before any external call.
