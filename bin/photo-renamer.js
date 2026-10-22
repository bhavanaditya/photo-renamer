#!/usr/bin/env node
/**
 * Photo Renamer command-line tool.
 *
 * Renames the photos in a folder by the date they were taken, for example
 * IMG_4521.HEIC -> 2026-10-12_Goa_001.heic. Shows a preview unless --apply
 * is given, and writes a log so a run can be undone with --undo.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import exifr from 'exifr'
import { DATE_FIELDS, TOKENS, applyRenames, dateFromExif, isPhoto, planRenames, reverseRenames } from '../src/core.js'

const LOG_FILE = '.photo-renamer-log.json'
const PACKAGE = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'))

const HELP = `Photo Renamer v${PACKAGE.version}

Rename photos by the date they were taken.

Usage:
  photo-renamer <folder> [options]

Options:
  -p, --pattern TEXT   How to name the files. Default: {date}_{n}
                       ({date}_{event}_{n} when --event is given)
  -e, --event TEXT     Text for {event}, e.g. "Goa Trip"
      --start N        First number for {n}. Default: 1
      --digits N       Width of {n}, e.g. 4 gives 0001. Default: 3
  -r, --recursive      Also rename photos in subfolders (each folder numbered separately)
      --no-file-date   Skip photos without a date taken, instead of using the file's date
  -a, --apply          Rename the files. Without this, only a preview is shown
      --undo           Put back the names from the last --apply in this folder
  -h, --help           Show this help
  -v, --version        Show the version

Placeholders:
  ${TOKENS.map(token => `{${token}}`).join(' ')}

Examples:
  photo-renamer ~/Pictures/Goa --event "Goa Trip"
  photo-renamer ~/Pictures/Goa --event "Goa Trip" --apply
  photo-renamer . --pattern "{date}_{time}" --apply
  photo-renamer ~/Pictures/Goa --undo
`

function fail(message, code = 2) {
	console.error(`Error: ${message}`)
	process.exit(code)
}

function parseOptions(argv) {
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			pattern: { type: 'string', short: 'p' },
			event: { type: 'string', short: 'e' },
			start: { type: 'string' },
			digits: { type: 'string' },
			recursive: { type: 'boolean', short: 'r' },
			'no-file-date': { type: 'boolean' },
			apply: { type: 'boolean', short: 'a' },
			undo: { type: 'boolean' },
			help: { type: 'boolean', short: 'h' },
			version: { type: 'boolean', short: 'v' },
		},
	})

	const number = (name, min) => {
		if (values[name] === undefined) {
			return undefined
		}
		const value = Number(values[name])
		if (!Number.isInteger(value) || value < min) {
			throw new Error(`--${name} must be a whole number of at least ${min}.`)
		}
		return value
	}

	return {
		folder: positionals[0],
		extra: positionals.slice(1),
		help: values.help,
		version: values.version,
		apply: Boolean(values.apply),
		undo: Boolean(values.undo),
		recursive: Boolean(values.recursive),
		plan: {
			pattern: values.pattern,
			event: values.event,
			start: number('start', 0),
			digits: number('digits', 1),
			useFileDate: !values['no-file-date'],
		},
	}
}

const HEAD_BYTES = 1024 * 1024

async function parseDate(buffer) {
	try {
		return dateFromExif(await exifr.parse(buffer, { pick: DATE_FIELDS }))
	} catch {
		return null
	}
}

// Reads the file ourselves (exifr's own file reader breaks on newer Node.js).
// The date is almost always near the start, so only read the whole file if needed.
async function readDateTaken(file, size) {
	const handle = await fs.open(file, 'r')
	try {
		const head = Buffer.alloc(Math.min(size, HEAD_BYTES))
		await handle.read(head, 0, head.length, 0)
		const date = await parseDate(head)
		if (date || size <= HEAD_BYTES) {
			return date
		}
		return await parseDate(await handle.readFile())
	} catch {
		return null
	} finally {
		await handle.close()
	}
}

// Runs fn over items, a few at a time.
async function mapLimit(items, limit, fn) {
	const results = new Array(items.length)
	let next = 0
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const index = next++
			results[index] = await fn(items[index])
		}
	})
	await Promise.all(workers)
	return results
}

async function listFolders(root) {
	const folders = [root]
	for (const entry of await fs.readdir(root, { withFileTypes: true })) {
		if (entry.isDirectory() && !entry.name.startsWith('.')) {
			folders.push(...await listFolders(path.join(root, entry.name)))
		}
	}
	return folders
}

function printPlan(folder, plan, apply) {
	console.log(`\n${folder}`)

	const changes = plan.renames.filter(item => item.from !== item.to)
	const width = Math.max(0, ...changes.map(item => item.from.length))

	for (const item of changes) {
		const note = item.source === 'file' ? '   (file date)' : ''
		console.log(`  ${item.from.padEnd(width)}  ->  ${item.to}${note}`)
	}
	for (const item of plan.skipped) {
		console.log(`  skip  ${item.name} (${item.reason})`)
	}
	if (!changes.length && !plan.skipped.length) {
		console.log(apply ? '  Nothing to rename.' : '  No photos to rename.')
	}

	return changes.length
}

async function renameFolder(folder, options) {
	const names = (await fs.readdir(folder, { withFileTypes: true }))
		.filter(entry => entry.isFile())
		.map(entry => entry.name)

	const photos = await mapLimit(names.filter(isPhoto), 8, async name => {
		const file = path.join(folder, name)
		const stat = await fs.stat(file)
		return { name, date: await readDateTaken(file, stat.size), fileDate: stat.mtime }
	})

	const plan = planRenames(photos, { ...options.plan, existing: names })
	const count = printPlan(folder, plan, options.apply)

	if (options.apply && count) {
		const changes = plan.renames.filter(item => item.from !== item.to)
		const log = {
			tool: 'photo-renamer',
			version: PACKAGE.version,
			date: new Date().toISOString(),
			renames: changes.map(({ from, to }) => ({ from, to })),
		}
		// Write the log first, so the run can be undone even if it is interrupted.
		await fs.writeFile(path.join(folder, LOG_FILE), JSON.stringify(log, null, 2))
		await applyRenames(changes, (from, to) => fs.rename(path.join(folder, from), path.join(folder, to)))
	}

	return count
}

async function undoFolder(folder) {
	const logPath = path.join(folder, LOG_FILE)
	let log
	try {
		log = JSON.parse(await fs.readFile(logPath, 'utf8'))
	} catch {
		console.log(`\n${folder}\n  Nothing to undo (no ${LOG_FILE} here).`)
		return 0
	}

	const renames = reverseRenames(log.renames || [])
	const names = new Set(await fs.readdir(folder))
	const missing = renames.filter(item => !names.has(item.from))
	if (missing.length) {
		throw new Error(`Cannot undo in ${folder}: ${missing.length} renamed file(s) are missing or were renamed again, e.g. ${missing[0].from}.`)
	}

	console.log(`\n${folder}`)
	for (const item of renames) {
		console.log(`  ${item.from}  ->  ${item.to}`)
	}
	await applyRenames(renames, (from, to) => fs.rename(path.join(folder, from), path.join(folder, to)))
	await fs.unlink(logPath)

	return renames.length
}

async function main() {
	let options
	try {
		options = parseOptions(process.argv.slice(2))
	} catch (error) {
		fail(`${error.message} Run with --help for usage.`)
	}

	if (options.help) {
		console.log(HELP)
		return
	}
	if (options.version) {
		console.log(PACKAGE.version)
		return
	}
	if (!options.folder) {
		fail('Missing folder. Run with --help for usage.')
	}
	if (options.extra.length) {
		fail(`Only one folder can be given. Put quotes around names with spaces, e.g. --event "Goa Trip".`)
	}

	const root = path.resolve(options.folder)
	const stat = await fs.stat(root).catch(() => null)
	if (!stat || !stat.isDirectory()) {
		fail(`Folder not found: ${options.folder}`)
	}

	const folders = options.recursive ? await listFolders(root) : [root]
	let total = 0

	try {
		for (const folder of folders) {
			total += options.undo ? await undoFolder(folder) : await renameFolder(folder, options)
		}
	} catch (error) {
		fail(error.message, 1)
	}

	if (options.undo) {
		console.log(`\nDone: ${total} photo(s) put back.`)
	} else if (options.apply) {
		console.log(`\nDone: ${total} photo(s) renamed. To undo, run the same command with --undo.`)
	} else {
		console.log(`\nPreview: ${total} photo(s) would be renamed. Nothing has changed yet. Add --apply to rename them.`)
	}
}

main()
