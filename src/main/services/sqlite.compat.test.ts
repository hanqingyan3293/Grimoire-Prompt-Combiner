import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createLegacyDatabase } from './sqlite.compat'

describe('sqlite compatibility adapter', () => {
  it('preserves the existing exec, run and prepare contract', () => {
    const native = new DatabaseSync(':memory:')
    const db = createLegacyDatabase(native)

    db.run('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')
    db.prepare('INSERT INTO items (name) VALUES (?)').run(['alpha'])
    db.prepare('INSERT INTO items (name) VALUES (?)').run(['beta'])

    expect(db.exec('SELECT id, name FROM items ORDER BY id')).toEqual([{
      columns: ['id', 'name'],
      values: [[1, 'alpha'], [2, 'beta']],
    }])
    expect(db.exec('SELECT name FROM items WHERE id=?', [2])).toEqual([{
      columns: ['name'],
      values: [['beta']],
    }])
    expect(db.prepare('SELECT name FROM items WHERE id=?').get([1])).toEqual({ name: 'alpha' })

    native.close()
  })
})
