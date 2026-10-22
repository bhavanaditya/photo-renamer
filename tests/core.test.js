import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyRenames, cleanPart, formatName, isPhoto, planRenames, reverseRenames } from '../src/core.js'

const at = (y, m, d, h = 12, min = 0, s = 0) => new Date(y, m - 1, d, h, min, s)

test('recognises photos and skips hidden files', () => {
	assert.equal(isPhoto('IMG_1.HEIC'), true)
	assert.equal(isPhoto('photo.jpeg'), true)
	assert.equal(isPhoto('notes.txt'), false)
	assert.equal(isPhoto('.hidden.jpg'), false)
	assert.equal(isPhoto('jpg'), false)
})

test('cleans text for file names', () => {
	assert.equal(cleanPart('  Goa Trip 2026 '), 'Goa-Trip-2026')
	assert.equal(cleanPart('a/b\\c:d*e?"<f>|'), 'abcdef')
})

test('fills in every placeholder', () => {
	const name = formatName('{year}{month}{day}-{hour}{minute}{second}_{date}_{time}_{event}_{name}_{n}', {
		date: at(2026, 3, 7, 9, 5, 2), n: 4, digits: 3, name: 'IMG 1', event: 'Goa',
	})
	assert.equal(name, '20260307-090502_2026-03-07_090502_Goa_IMG-1_004')
})

test('drops separators left by an empty event', () => {
	assert.equal(formatName('{date}_{event}_{n}', { date: at(2026, 10, 12), n: 1 }), '2026-10-12_001')
})

test('sorts by date taken and numbers in order', () => {
	const { renames } = planRenames([
		{ name: 'b.jpg', date: at(2026, 10, 12, 9) },
		{ name: 'a.jpg', date: at(2026, 10, 11, 18) },
		{ name: 'c.HEIC', date: at(2026, 10, 12, 9) },
	], { event: 'Goa Trip' })

	assert.deepEqual(renames.map(r => [r.from, r.to]), [
		['a.jpg', '2026-10-11_Goa-Trip_001.jpg'],
		['b.jpg', '2026-10-12_Goa-Trip_002.jpg'],
		['c.HEIC', '2026-10-12_Goa-Trip_003.heic'],
	])
})

test('falls back to the file date, or skips when asked', () => {
	const photos = [
		{ name: 'scan.png', date: null, fileDate: at(2026, 1, 2) },
		{ name: 'none.png', date: null, fileDate: null },
	]

	const withFallback = planRenames(photos)
	assert.equal(withFallback.renames[0].to, '2026-01-02_001.png')
	assert.equal(withFallback.renames[0].source, 'file')
	assert.deepEqual(withFallback.skipped, [{ name: 'none.png', reason: 'no date found' }])

	const strict = planRenames(photos, { useFileDate: false })
	assert.equal(strict.renames.length, 0)
	assert.equal(strict.skipped.length, 2)
})

test('widens the counter for big sets and honours start and digits', () => {
	const photos = Array.from({ length: 1200 }, (_, i) => ({ name: `p${i}.jpg`, date: at(2026, 1, 1, 0, 0, i % 60) }))
	assert.match(planRenames(photos).renames[0].to, /_0001\.jpg$/)
	assert.equal(planRenames(photos.slice(0, 2), { start: 7, digits: 2 }).renames[0].to, '2026-01-01_07.jpg')
})

test('never clashes with other files in the folder', () => {
	const { renames } = planRenames(
		[{ name: 'a.jpg', date: at(2026, 10, 12) }, { name: 'b.jpg', date: at(2026, 10, 12) }],
		{ pattern: '{date}', existing: ['a.jpg', 'b.jpg', '2026-10-12.jpg'] },
	)
	assert.deepEqual(renames.map(r => r.to), ['2026-10-12-2.jpg', '2026-10-12-3.jpg'])
})

test('rejects unknown placeholders and folders in the pattern', () => {
	assert.throws(() => planRenames([], { pattern: '{date}_{place}' }), /Unknown placeholder \{place\}/)
	assert.throws(() => planRenames([], { pattern: '{year}/{month}' }), /cannot contain/)
})

function memoryFolder(names) {
	const files = new Set(names)
	return {
		files,
		async rename(from, to) {
			if (!files.has(from)) throw new Error(`missing ${from}`)
			if (files.has(to)) throw new Error(`exists ${to}`)
			files.delete(from)
			files.add(to)
		},
	}
}

test('applies swaps safely and can be reversed', async () => {
	const folder = memoryFolder(['a.jpg', 'b.jpg'])
	const renames = [{ from: 'a.jpg', to: 'b.jpg' }, { from: 'b.jpg', to: 'a.jpg' }]

	assert.equal(await applyRenames(renames, folder.rename), 2)
	assert.deepEqual([...folder.files].sort(), ['a.jpg', 'b.jpg'])

	await applyRenames(reverseRenames(renames), folder.rename)
	assert.deepEqual([...folder.files].sort(), ['a.jpg', 'b.jpg'])
})

test('rolls back when a rename fails', async () => {
	const folder = memoryFolder(['a.jpg', 'b.jpg'])
	let calls = 0
	const flaky = async (from, to) => {
		if (++calls === 3) throw new Error('disk full')
		return folder.rename(from, to)
	}

	await assert.rejects(applyRenames([{ from: 'a.jpg', to: 'x.jpg' }, { from: 'b.jpg', to: 'y.jpg' }], flaky), /disk full/)
	assert.deepEqual([...folder.files].sort(), ['a.jpg', 'b.jpg'])
})
