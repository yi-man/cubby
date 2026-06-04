import { describe, expect, it } from 'vitest';
import { SCHEMA_SQL } from './schema.js';

describe('schema', () => {
  it('contains sessions table', () => {
    expect(SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS sessions');
  });

  it('contains terminals table', () => {
    expect(SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS terminals');
  });

  it('contains terminal outputs table', () => {
    expect(SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS terminal_outputs');
  });

  it('contains terminal output sequence columns', () => {
    expect(SCHEMA_SQL).toContain('seq_start INTEGER');
    expect(SCHEMA_SQL).toContain('seq_end INTEGER');
  });
});
