# Support

Thanks for using `@vijaypjavvadi/pw-self-heal`. Here is where to get help.

## Documentation

- [README](README.md) — installation, modes, and quick start
- [SPEC](SPEC.md) — how healing and ranking work
- [Roadmap](ROADMAP.md) — what is shipping next

## Questions

Open a [GitHub issue](https://github.com/javvadivijayprasad/pw-self-heal/issues)
with the `question` label. Please check existing issues first.

## Reporting a bug

Open a [GitHub issue](https://github.com/javvadivijayprasad/pw-self-heal/issues)
and include:

1. Package version (`npm ls @vijaypjavvadi/pw-self-heal`) and Playwright version
2. Node.js version and OS
3. Healing mode: `heuristic`, `ml`, or `hybrid`
4. The original (broken) locator and, if possible, a minimal DOM snippet
5. What you expected vs. what happened (healing logs help a lot)

The DOM never leaves your machine when using this library, but only share DOM
snippets in an issue if they contain no sensitive data.

## Security issues

Please do **not** open a public issue for security vulnerabilities. Email
[jvijayprasad@gmail.com](mailto:jvijayprasad@gmail.com) instead.

## Contributing

Want to fix it yourself? See [CONTRIBUTING.md](CONTRIBUTING.md) — note the
project rule that every change ships 100% tested.
