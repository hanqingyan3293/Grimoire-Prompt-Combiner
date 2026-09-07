import { DatabaseSync, type StatementSync } from 'node:sqlite'

type NativeSqlParameter = null | number | bigint | string | NodeJS.ArrayBufferView

export interface LegacyQueryBlock {
  columns: string[]
  values: unknown[][]
}

export type LegacyQueryResult = LegacyQueryBlock[]

export interface LegacyPreparedStatement {
  run(parameters?: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint }
  get(parameters?: unknown[]): Record<string, unknown> | undefined
  all(parameters?: unknown[]): Record<string, unknown>[]
  free(): void
}

export interface LegacyDatabase {
  exec(sql: string, parameters?: unknown[]): LegacyQueryResult
  run(sql: string, parameters?: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint }
  prepare(sql: string): LegacyPreparedStatement
}

function normalizeParameters(parameters: unknown[] = []): NativeSqlParameter[] {
  return parameters.map(parameter => parameter === undefined ? null : parameter as NativeSqlParameter)
}

function isQuery(sql: string): boolean {
  return /^\s*(SELECT|WITH|PRAGMA|EXPLAIN)\b/i.test(sql)
}

function resultFromRows(rows: Record<string, unknown>[]): LegacyQueryResult {
  const columns = rows.length ? Object.keys(rows[0]) : []
  return [{ columns, values: rows.map(row => columns.map(column => row[column])) }]
}

export function createLegacyDatabase(native: DatabaseSync): LegacyDatabase {
  const wrapStatement = (statement: StatementSync): LegacyPreparedStatement => ({
    run(parameters = []) {
      return statement.run(...normalizeParameters(parameters))
    },
    get(parameters = []) {
      return statement.get(...normalizeParameters(parameters))
    },
    all(parameters = []) {
      return statement.all(...normalizeParameters(parameters))
    },
    free() {
      // node:sqlite statements are released by the native runtime; this method
      // keeps the existing sql.js call contract source-compatible.
    },
  })

  return {
    exec(sql, parameters = []) {
      if (parameters.length > 0 || isQuery(sql)) {
        const statement = native.prepare(sql)
        try {
          return resultFromRows(statement.all(...normalizeParameters(parameters)))
        } finally {
        }
      }
      native.exec(sql)
      return []
    },
    run(sql, parameters = []) {
      const statement = native.prepare(sql)
      try {
        return statement.run(...normalizeParameters(parameters))
      } finally {
      }
    },
    prepare(sql) {
      return wrapStatement(native.prepare(sql))
    },
  }
}
