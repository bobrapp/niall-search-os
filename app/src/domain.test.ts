import { describe, expect, it, vi } from 'vitest';
import { collections, exportBackup, importBackup, initialBackup, newRow, offerTotals, removeExamples } from './data';
import { exportCsv, importConnections, parseDigest } from './imports';
import { keywordMatch } from './keywords';

describe('backup', () => {
  it('round trips every list and unknown fields without loss', () => {
    const original = { ...initialBackup(), future: { extension: true } };
    original.settings = { positioning: 'Northwind', future: { enabled: true } };
    for (const key of collections) original[key].push({ example: true, name: 'Contoso', future: [1, null, false] }, { name: 'Fabrikam' });
    original.targets[0].id = 'contoso';
    original.contacts[0].targetId = 'contoso';
    const restored = importBackup(exportBackup(original));
    expect(restored).toMatchObject(original);
    for (const key of collections) expect(new Set(restored[key].map(row => row.id)).size).toBe(restored[key].length);
    expect(restored.targets[0].id).toBe('contoso');
    expect(restored.contacts[0].targetId).toBe('contoso');
    expect(importBackup(exportBackup(restored))).toEqual(restored);
    expect(removeExamples(original).board).toEqual([{ name: 'Fabrikam' }]);
    expect(original.board).toHaveLength(2);
  });
  it('rejects missing collections', () => expect(() => importBackup('{"settings":{}}')).toThrow());
  it('rejects a backup with a malformed tool budget entry', () => {
    const backup = initialBackup();
    backup.settings.tools = [{ name: 'Fabrikam' }, null];
    expect(() => importBackup(exportBackup(backup))).toThrow('Backup tool budget must be a list of records.');
  });
  it('creates RFC 4122 version 4 IDs without randomUUID', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(255));
    vi.stubGlobal('crypto', { getRandomValues });
    try {
      expect(newRow({ name: 'Fabrikam' })).toEqual({ id: 'ffffffff-ffff-4fff-bfff-ffffffffffff', name: 'Fabrikam' });
      expect(getRandomValues).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('LinkedIn CSV', () => {
  it('handles a preamble, BOM, quotes, comma/newline cells and discards email', () => {
    const csv = '\uFEFFNotes:\r\n\r\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\r\nAvery,Example,,private@example.invalid," Northwind, Inc. ","Head of ""Craft""\nTeam",01 Jan 2025\r\nCasey,Example,,another@example.invalid,Contoso,Director,02 Jan 2025';
    const result = importConnections(csv, [{ id: 'target', name: 'Northwind', aliases: ['Northwind, Inc.'] }]);
    expect(result).toMatchObject([{ name: 'Avery Example', targetId: 'target', title: 'Head of "Craft"\nTeam', relationship: 'Warm' }, { targetId: '', company: 'Contoso' }]);
    expect(JSON.stringify(result)).not.toContain('@example.invalid');
  });
  it('neutralizes spreadsheet formulas in CSV exports', () => {
    expect(exportCsv([{ name: '=Contoso' }], [['name', 'Name']])).toBe('"Name"\r\n"\'=Contoso"');
  });
});

describe('digest and local calculations', () => {
  it('reads the scout fit, location, rationale and URL and ignores failure footer', () => {
    const roles = parseDigest('Niall Search OS digest - Today\n\n[8/10] Head of Craft - Northwind\n    Remote\n    Why: Strong scope\n    https://example.invalid/role\n\n[?/10] Head - Contoso\n    https://example.invalid/role2\n\nSources not read this run:\n  - Fabrikam', [{ id: 'northwind', name: 'Northwind' }]);
    expect(roles).toMatchObject([{ title: 'Head of Craft', company: 'Northwind', fit: '8', targetId: 'northwind', location: 'Remote', notes: 'Strong scope', url: 'https://example.invalid/role', stage: 'Spotted' }, { fit: '', company: 'Contoso' }]);
  });
  it('counts unique normalized terms and reports missing terms', () => {
    expect(keywordMatch('FinOps and FinOps, governance, SQL.', 'SQL finops')).toEqual({ score: 67, hits: ['finops', 'sql'], missing: ['governance'] });
    expect(keywordMatch('and the', '')).toEqual({ score: 0, hits: [], missing: [] });
  });
  it('applies the bonus percentage and sign-on only to first-year compensation', () => {
    expect(offerTotals({ base: 200, bonus: 25, equity: 30, signOn: 10 })).toMatchObject({ annual: 280, firstYear: 290 });
  });
  it('rounds the bonus to the nearest minor unit before adding it', () => {
    expect(offerTotals({ base: '100.50', bonus: '1' })).toEqual({ annual: 101.51, firstYear: 101.51, annualMinor: 10151 });
  });
});
