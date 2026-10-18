import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const read = (name: string) => readFileSync(resolve(root, name), 'utf8');

const pkg = JSON.parse(read('package.json')) as { version: string };

describe('community docs (JOSS W1)', () => {
  const required = [
    'CONTRIBUTING.md',
    'SUPPORT.md',
    'CODE_OF_CONDUCT.md',
    'CHANGELOG.md',
  ];

  it.each(required)('%s exists and is non-trivial', (name) => {
    const body = read(name);
    expect(body.length).toBeGreaterThan(500);
    expect(body.trimStart().startsWith('#')).toBe(true);
  });

  describe('CONTRIBUTING.md', () => {
    const body = read('CONTRIBUTING.md');

    it('documents the dev workflow commands', () => {
      expect(body).toContain('npm install');
      expect(body).toContain('npm run build');
      expect(body).toContain('npm test');
    });

    it('states the 100% tested rule', () => {
      expect(body).toMatch(/100% tested/i);
      expect(body).toMatch(/every change ships with tests/i);
    });

    it('links the code of conduct, support doc, and license', () => {
      expect(body).toContain('CODE_OF_CONDUCT.md');
      expect(body).toContain('SUPPORT.md');
      expect(body).toContain('LICENSE');
    });

    it('asks for conventional commits', () => {
      expect(body).toMatch(/conventional commits/i);
    });
  });

  describe('SUPPORT.md', () => {
    const body = read('SUPPORT.md');

    it('points to the GitHub issue tracker', () => {
      expect(body).toContain(
        'https://github.com/javvadivijayprasad/pw-self-heal/issues',
      );
    });

    it('asks bug reporters for the healing mode', () => {
      expect(body).toContain('heuristic');
      expect(body).toContain('hybrid');
    });

    it('gives a private channel for security reports', () => {
      expect(body).toMatch(/security/i);
      expect(body).toContain('jvijayprasad@gmail.com');
    });
  });

  describe('CODE_OF_CONDUCT.md', () => {
    const body = read('CODE_OF_CONDUCT.md');

    it('is based on the Contributor Covenant with attribution link', () => {
      expect(body).toContain('Contributor Covenant');
      expect(body).toContain('contributor-covenant.org');
    });

    it('has the standard sections', () => {
      for (const section of [
        '## Our Pledge',
        '## Our Standards',
        '## Scope',
        '## Enforcement',
      ]) {
        expect(body).toContain(section);
      }
    });

    it('names a reporting contact', () => {
      expect(body).toContain('jvijayprasad@gmail.com');
    });
  });

  describe('CHANGELOG.md', () => {
    const body = read('CHANGELOG.md');

    it('follows Keep a Changelog with an Unreleased section', () => {
      expect(body).toContain('keepachangelog.com');
      expect(body).toContain('semver.org');
      expect(body).toContain('## [Unreleased]');
    });

    it('has an entry for the current package.json version', () => {
      expect(body).toContain(`## [${pkg.version}]`);
    });

    it('has an entry for every released version, newest first', () => {
      const versions = [...body.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map(
        (m) => m[1],
      );
      // At least the first stable release is present, and entries are newest
      // first — assert ordering, not a frozen list (new releases must not break this).
      expect(versions.length).toBeGreaterThan(0);
      expect(versions).toContain('1.0.0');
      const sorted = [...versions].sort((a, b) =>
        b.localeCompare(a, undefined, { numeric: true }),
      );
      expect(versions).toEqual(sorted);
    });

    it('release headings carry ISO dates', () => {
      const undated = [...body.matchAll(/^## \[(\d+\.\d+\.\d+)\](?! - \d{4}-\d{2}-\d{2})/gm)];
      expect(undated).toEqual([]);
    });
  });
});

describe('model card (JOSS W6)', () => {
  const body = read('docs/model-card.md');

  it('exists and is substantive', () => {
    expect(body.length).toBeGreaterThan(1500);
    expect(body.trimStart().startsWith('#')).toBe(true);
  });

  it('covers the required model-card sections', () => {
    for (const section of [
      'Model details',
      '17 features',
      'Intended use',
      'Training',
      'Metrics',
      'Limitations',
      'Ethical',
      'Citation',
    ]) {
      expect(body).toContain(section);
    }
  });

  it('states the headline metrics and provenance', () => {
    expect(body).toContain('0.9993'); // GB AUC
    expect(body).toContain('68.63'); // hybrid HSR
    expect(body).toContain('10.5281/zenodo.19684439'); // Zenodo DOI
  });
});
