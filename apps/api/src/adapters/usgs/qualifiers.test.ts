import { describe, expect, it } from 'vitest';
import { informationalCodes, mapUsgsQualifiers, unreliableCodes } from './qualifiers.ts';

describe('mapUsgsQualifiers', () => {
  it('maps approval status Provisional to provisional, and Approved to nothing', () => {
    expect(mapUsgsQualifiers('Provisional', null)).toEqual({
      qualifiers: ['provisional'],
      unrecognized: [],
    });
    expect(mapUsgsQualifiers('Approved', null)).toEqual({ qualifiers: [], unrecognized: [] });
  });

  it('maps the specific reliability codes', () => {
    expect(mapUsgsQualifiers('Approved', ['ICE']).qualifiers).toEqual(['iceAffected']);
    expect(mapUsgsQualifiers('Approved', ['EQUIP']).qualifiers).toEqual(['equipmentMalfunction']);
    expect(mapUsgsQualifiers('Approved', ['ESTIMATED']).qualifiers).toEqual(['estimated']);
  });

  it.each([...unreliableCodes])('maps %s to unreliable', (code) => {
    expect(mapUsgsQualifiers('Approved', [code])).toEqual({
      qualifiers: ['unreliable'],
      unrecognized: [],
    });
  });

  it('covers the codes decided in #13', () => {
    expect([...unreliableCodes].sort()).toEqual([
      'BACKWATER',
      'BLWMIN',
      'DAMFAILURE',
      'DEBRIS',
      'FLOOD',
      'LESSTHAN',
      'MAINT',
      'RATINGDEV',
      'TEST',
    ]);
    expect([...informationalCodes].sort()).toEqual([
      'DIFFDATUM',
      'DISCONTINUED',
      'DRY',
      'FORCEINTERPOLATION',
      'OPPORTUNISTIC',
      'OTHERAGENCY',
      'REGULATED',
      'REVISED',
      'SEASONAL',
      'TIDE',
      'UNAVAIL',
      'URBAN',
      'ZEROFLOW',
    ]);
  });

  it.each([...informationalCodes])('ignores the informational code %s', (code) => {
    expect(mapUsgsQualifiers('Approved', [code])).toEqual({ qualifiers: [], unrecognized: [] });
  });

  it('treats an unrecognized code as unreliable and reports it for logging', () => {
    expect(mapUsgsQualifiers('Approved', ['GHNOTASSCPKQ', 'NEWCODE'])).toEqual({
      qualifiers: ['unreliable'],
      unrecognized: ['GHNOTASSCPKQ', 'NEWCODE'],
    });
  });

  it('combines codes without duplicates', () => {
    expect(
      mapUsgsQualifiers('Provisional', ['DISCONTINUED', 'EQUIP', 'MAINT', 'FLOOD', 'EQUIP']),
    ).toEqual({
      qualifiers: ['provisional', 'equipmentMalfunction', 'unreliable'],
      unrecognized: [],
    });
  });

  it('treats an unknown approval status as unrecognized, not as approved', () => {
    expect(mapUsgsQualifiers('Pending', null)).toEqual({
      qualifiers: ['unreliable'],
      unrecognized: ['approval_status:Pending'],
    });
  });
});
