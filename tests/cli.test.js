import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { jpegWithDate } from './helpers.js'

const CLI = fileURLToPath(new URL('../bin/photo-renamer.js', import.meta.url))

function run(...args) {
	return execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })
}

function makeFolder() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-renamer-'))
	fs.writeFileSync(path.join(dir, 'IMG_0002.JPG'), jpegWithDate('2026:10:12 09:30:00'))
	fs.writeFileSync(path.join(dir, 'IMG_0001.JPG'), jpegWithDate('2026:10:11 18:00:00'))
	fs.writeFileSync(path.join(dir, 'scan.png'), 'not really a png')
	fs.utimesSync(path.join(dir, 'scan.png'), new Date(2026, 9, 13, 12), new Date(2026, 9, 13, 12))
	fs.writeFileSync(path.join(dir, 'notes.txt'), 'keep me')
	fs.writeFileSync(path.join(dir, '.hidden.jpg'), 'keep me')
	return dir
}

const list = dir => fs.readdirSync(dir).filter(name => !name.startsWith('.photo-renamer-log')).sort()

test('preview changes nothing', () => {
	const dir = makeFolder()
	const before = list(dir)
	const out = run(dir, '--event', 'Goa Trip')

	assert.match(out, /IMG_0001\.JPG\s+->\s+2026-10-11_Goa-Trip_001\.jpg/)
	assert.match(out, /scan\.png\s+->\s+2026-10-13_Goa-Trip_003\.png\s+\(file date\)/)
	assert.match(out, /Preview: 3 photo\(s\) would be renamed/)
	assert.deepEqual(list(dir), before)
})

test('--apply renames, --undo puts everything back', () => {
	const dir = makeFolder()
	const before = list(dir)

	const out = run(dir, '-e', 'Goa Trip', '--apply')
	assert.match(out, /Done: 3 photo\(s\) renamed/)
	assert.deepEqual(list(dir), [
		'.hidden.jpg',
		'2026-10-11_Goa-Trip_001.jpg',
		'2026-10-12_Goa-Trip_002.jpg',
		'2026-10-13_Goa-Trip_003.png',
		'notes.txt',
	])
	assert.ok(fs.existsSync(path.join(dir, '.photo-renamer-log.json')))

	assert.match(run(dir, '--undo'), /Done: 3 photo\(s\) put back/)
	assert.deepEqual(list(dir), before)
	assert.ok(!fs.existsSync(path.join(dir, '.photo-renamer-log.json')))
})

test('running twice is safe', () => {
	const dir = makeFolder()
	run(dir, '--apply')
	const after = list(dir)
	assert.match(run(dir, '--apply'), /Done: 0 photo\(s\) renamed/)
	assert.deepEqual(list(dir), after)
})

test('--recursive numbers each folder separately', () => {
	const dir = makeFolder()
	const sub = path.join(dir, 'Day 2')
	fs.mkdirSync(sub)
	fs.writeFileSync(path.join(sub, 'DSC1.jpg'), jpegWithDate('2026:10:14 08:00:00'))

	run(dir, '--recursive', '--no-file-date', '--apply')
	assert.deepEqual(fs.readdirSync(sub).filter(n => !n.startsWith('.')), ['2026-10-14_001.jpg'])
	assert.ok(fs.existsSync(path.join(dir, 'scan.png')), 'scan.png has no date taken, so it is skipped')
})

test('bad input gives a clear error', () => {
	const missing = spawnSync(process.execPath, [CLI, '/no/such/folder'], { encoding: 'utf8' })
	assert.equal(missing.status, 2)
	assert.match(missing.stderr, /Folder not found/)

	const badPattern = spawnSync(process.execPath, [CLI, os.tmpdir(), '--pattern', '{place}'], { encoding: 'utf8' })
	assert.equal(badPattern.status, 1)
	assert.match(badPattern.stderr, /Unknown placeholder \{place\}/)

	const unquoted = spawnSync(process.execPath, [CLI, os.tmpdir(), '--event', 'Goa', 'Trip'], { encoding: 'utf8' })
	assert.equal(unquoted.status, 2)
	assert.match(unquoted.stderr, /Put quotes around names with spaces/)
})
