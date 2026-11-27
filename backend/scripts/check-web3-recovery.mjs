#!/usr/bin/env node
// Evaluate an evidence report only; never changes runtime recovery permissions.
import { readFile } from 'node:fs/promises'
import { evaluateRecovery } from '../dist/web3/recovery-report.js'
if (process.argv.length !== 3)
  throw new Error('Provide an explicit local recovery evidence JSON file')
const result = evaluateRecovery(JSON.parse(await readFile(process.argv[2], 'utf8')))
console.log(JSON.stringify(result, null, 2))
if (!result.targetsMet) process.exitCode = 1
