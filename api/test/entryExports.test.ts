// workerd accepts only handlers and classes as exports of the entry module. A plain constant exported from src/index.ts
// (SCHEDULE_CRON, #179) is tolerated by this test pool but stops `wrangler dev` with "Incorrect type for map entry".
// Keep shared constants in a module the entry imports, not in the entry's own exports.
import { describe, expect, it } from 'vitest'
import * as entry from '../src/index'

describe('Worker entry module', () => {
  it('exports only the handler and the Workflow class', () => {
    expect(Object.keys(entry).sort()).toEqual(['ModelCallWorkflow', 'default'])
  })
})
