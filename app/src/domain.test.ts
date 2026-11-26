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
    expect(() => importBackup(JSON.stringify(backup))).toThrow('Backup tool budget must be a list of records.');
  });
  it('exports a restorable copy of a legacy workspace with malformed tools', () => {
    const backup = initialBackup();
    backup.settings.positioning = 'Northwind';
    backup.roles = [{ id: 'role', title: 'Head of Craft' }];
    for (const [tools, expected] of [[null, []], [[null, { id: 'tool', name: 'Contoso', extra: [1] }], [{ id: 'tool', name: 'Contoso', extra: [1] }]]]) {
      backup.settings.tools = tools;
      const restored = importBackup(exportBackup(backup));
      expect(restored).toEqual({ ...backup, settings: { ...backup.settings, tools: expected } });
      expect(backup.settings.tools).toBe(tools);
    }
  });
  it('restores known links to replaced IDs but leaves ambiguous and unknown references alone', () => {
    const original = {
      ...initialBackup(),
      targets: [{ id: 42, name: 'Northwind' }, { id: 'contoso', name: 'Contoso' }, { id: 12 }, { id: 12 }],
      contacts: [{ id: '  ', name: 'Avery Example', targetId: 42 }, { id: 'casey', targetId: 'contoso' }, { targetId: 12 }],
      roles: [{ id: 42, title: 'Head of Craft', targetId: 42 }],
      outreach: [{ targetId: 42, contactId: '  ', extension: { targetId: 42 } }, { targetId: '', contactId: '' }],
      engage: [{ targetId: 42 }],
      interviews: [{ roleId: 42 }],
      offers: [{ roleId: 42 }],
      refs: [{ roleId: 42 }],
    };
    const restored = importBackup(JSON.stringify(original));
    const [northwind, contoso, ...ambiguous] = restored.targets;
    const [avery, casey, unlinked] = restored.contacts;
    const [role] = restored.roles;
    expect(northwind.id).toEqual(expect.any(String));
    expect(avery.id).toEqual(expect.any(String));
    expect(role.id).toEqual(expect.any(String));
    expect(ambiguous[0].id).not.toBe(ambiguous[1].id);
    expect([avery.targetId, role.targetId, restored.outreach[0].targetId, restored.engage[0].targetId]).toEqual(Array(4).fill(northwind.id));
    expect([restored.interviews[0].roleId, restored.offers[0].roleId, restored.refs[0].roleId]).toEqual(Array(3).fill(role.id));
    expect(restored.outreach[0]).toMatchObject({ contactId: avery.id, extension: { targetId: 42 } });
    expect(restored.outreach[1]).toMatchObject({ targetId: '', contactId: '' });
    expect(contoso.id).toBe('contoso');
    expect(casey.targetId).toBe('contoso');
    expect(unlinked.targetId).toBe(12);
    expect(importBackup(exportBackup(restored))).toEqual(restored);
  });
  it('restores links stored as strings to targets whose old ID was a number', () => {
    const original = { ...initialBackup(), targets: [{ id: 42, name: 'Northwind' }], contacts: [{ id: 'avery', targetId: '42' }] };
    const restored = importBackup(JSON.stringify(original));
    expect(restored.targets[0].id).toEqual(expect.any(String));
    expect(restored.targets[0].id).not.toBe('42');
    expect(restored.contacts[0].targetId).toBe(restored.targets[0].id);
  });
  it('leaves a string link alone when a kept target already has that ID', () => {
    const original = { ...initialBackup(), targets: [{ id: 42 }, { id: '42' }], contacts: [{ id: 'avery', targetId: '42' }, { id: 'casey', targetId: 42 }] };
    const restored = importBackup(JSON.stringify(original));
    expect(restored.targets[1].id).toBe('42');
    expect(restored.contacts[0].targetId).toBe('42');
    expect(restored.contacts[1].targetId).toBe(restored.targets[0].id);
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
  it('keeps the full bonus rate until rounding the currency amount', () => {
    expect(offerTotals({ base: '200000', bonus: '12.125' }).annualMinor).toBe(22_425_000);
    expect(offerTotals({ base: '100', bonus: '1.005' }).annualMinor).toBe(10_101);
    expect(offerTotals({ base: '100', bonus: '1.00499999999999999999' }).annualMinor).toBe(10_100);
  });
});
