/**
 * Photo Renamer web app.
 *
 * In Chrome and Edge on a computer, photos are renamed in place in the chosen
 * folder. Elsewhere, renamed copies are downloaded as a ZIP. Nothing is uploaded.
 */

import { parse as parseExif } from 'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.esm.mjs'
import {
	DATE_FIELDS, DEFAULT_EVENT_PATTERN, DEFAULT_PATTERN,
	applyRenames, dateFromExif, isPhoto, planRenames, reverseRenames,
} from './core.js'

const JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'
const PREVIEW_LIMIT = 500
const canRenameInPlace = typeof window.showDirectoryPicker === 'function'

const $ = id => document.getElementById(id)
const ui = {
	pickFolder: $('pick-folder'),
	pickFolderFallback: $('pick-folder-fallback'),
	pickFiles: $('pick-files'),
	modeHint: $('mode-hint'),
	event: $('event'),
	pattern: $('pattern'),
	start: $('start'),
	useFileDate: $('use-file-date'),
	patternError: $('pattern-error'),
	status: $('status'),
	previewWrap: $('preview-wrap'),
	preview: $('preview'),
	rename: $('rename'),
	download: $('download'),
	undo: $('undo'),
}

/**
 * groups: one per folder.
 * { label, dir (FileSystemDirectoryHandle, in-place mode only), photos: [{ name, file, date, fileDate }], existing: [names] }
 */
let groups = []
let plans = []
let lastRun = null
let busy = false

ui.modeHint.textContent = canRenameInPlace
	? 'Your browser can rename the photos right in the folder you choose.'
	: 'Your browser can\'t rename files in place, so you\'ll get a ZIP of renamed copies. To rename in place, use Chrome or Edge on a computer.'

function setStatus(text, done = false) {
	ui.status.textContent = text
	ui.status.classList.toggle('done', done)
}

function setBusy(value) {
	busy = value
	for (const button of [ui.pickFolder, ui.rename, ui.download, ui.undo]) {
		button.disabled = value
	}
}

async function readDate(file) {
	try {
		return dateFromExif(await parseExif(file, { pick: DATE_FIELDS }))
	} catch {
		return null
	}
}

// Reads the dates of every photo, a few at a time, with progress.
async function readDates(newGroups) {
	const all = newGroups.flatMap(group => group.photos)
	let done = 0
	let next = 0

	const worker = async () => {
		while (next < all.length) {
			const photo = all[next++]
			photo.date = await readDate(photo.file)
			done++
			if (done % 10 === 0 || done === all.length) {
				setStatus(`Reading dates… ${done} of ${all.length}`)
			}
		}
	}
	await Promise.all(Array.from({ length: Math.min(6, all.length) }, worker))
}

async function load(newGroups) {
	const count = newGroups.reduce((sum, group) => sum + group.photos.length, 0)
	if (!count) {
		groups = []
		render()
		setStatus('No photos found. Supported: JPG, HEIC, PNG, WebP, TIFF and camera RAW files.')
		return
	}

	setBusy(true)
	lastRun = null
	setStatus(`Reading dates… 0 of ${count}`)
	await readDates(newGroups)
	groups = newGroups
	setBusy(false)
	update()
}

function photoFromFile(file) {
	return { name: file.name, file, date: null, fileDate: new Date(file.lastModified) }
}

// "Choose a folder" with the File System Access API: rename in place.
async function pickFolder() {
	if (!canRenameInPlace) {
		ui.pickFolderFallback.click()
		return
	}

	let dir
	try {
		dir = await window.showDirectoryPicker({ id: 'photo-renamer', mode: 'readwrite' })
	} catch (error) {
		if (error.name !== 'AbortError') {
			setStatus(`Could not open the folder: ${error.message}`)
		}
		return
	}

	const photos = []
	const existing = []
	for await (const entry of dir.values()) {
		if (entry.kind !== 'file') {
			continue
		}
		existing.push(entry.name)
		if (isPhoto(entry.name)) {
			photos.push(photoFromFile(await entry.getFile()))
		}
	}

	await load([{ label: dir.name, dir, photos, existing }])
}

// A folder picked with <input webkitdirectory>: group the files by subfolder.
function loadFolderFiles(fileList) {
	const byFolder = new Map()
	for (const file of fileList) {
		const relative = file.webkitRelativePath || file.name
		const folder = relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : ''
		if (!byFolder.has(folder)) {
			byFolder.set(folder, { label: folder, path: folder, photos: [], existing: [] })
		}
		const group = byFolder.get(folder)
		group.existing.push(file.name)
		if (isPhoto(file.name)) {
			group.photos.push(photoFromFile(file))
		}
	}
	return load([...byFolder.values()].filter(group => group.photos.length))
}

function loadFiles(fileList) {
	const files = [...fileList]
	return load([{
		label: 'Selected photos',
		path: '',
		photos: files.filter(file => isPhoto(file.name)).map(photoFromFile),
		existing: files.map(file => file.name),
	}])
}

function options() {
	const start = parseInt(ui.start.value, 10)
	return {
		event: ui.event.value,
		pattern: ui.pattern.value.trim() || undefined,
		start: Number.isInteger(start) && start >= 0 ? start : 1,
		useFileDate: ui.useFileDate.checked,
	}
}

function update() {
	ui.pattern.placeholder = ui.event.value.trim() ? DEFAULT_EVENT_PATTERN : DEFAULT_PATTERN

	try {
		plans = groups.map(group => ({ group, ...planRenames(group.photos, { ...options(), existing: group.existing }) }))
		ui.patternError.hidden = true
	} catch (error) {
		plans = []
		ui.patternError.textContent = error.message
		ui.patternError.hidden = false
	}
	render()
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function cell(text, className) {
	const td = document.createElement('td')
	td.textContent = text
	if (className) {
		td.className = className
	}
	return td
}

function render() {
	ui.preview.replaceChildren()
	const showFolder = groups.length > 1
	const changes = plans.flatMap(plan => plan.renames.filter(item => item.from !== item.to).map(item => ({ ...item, label: plan.group.label })))
	const skipped = plans.flatMap(plan => plan.skipped.map(item => ({ ...item, label: plan.group.label })))

	for (const item of changes.slice(0, PREVIEW_LIMIT)) {
		const row = document.createElement('tr')
		const prefix = showFolder && item.label ? `${item.label}/` : ''
		row.append(cell(prefix + item.from), cell(item.to, 'new'))
		const date = cell(dateFormat.format(item.date), 'date')
		if (item.source === 'file') {
			const badge = document.createElement('span')
			badge.className = 'badge'
			badge.textContent = 'file date'
			badge.title = 'No date taken in this photo, so the file\'s date was used'
			date.append(badge)
		}
		row.append(date)
		ui.preview.append(row)
	}

	for (const item of skipped.slice(0, PREVIEW_LIMIT)) {
		const row = document.createElement('tr')
		row.className = 'skip'
		row.append(cell(item.name), cell(`Skipped: ${item.reason}`), cell('', 'date'))
		ui.preview.append(row)
	}

	ui.previewWrap.hidden = !changes.length && !skipped.length
	const inPlace = groups.length > 0 && groups.every(group => group.dir)
	ui.rename.hidden = !changes.length || !inPlace
	ui.download.hidden = !changes.length || inPlace
	ui.undo.hidden = !lastRun
	ui.rename.textContent = `Rename ${changes.length} photo${changes.length === 1 ? '' : 's'}`

	if (busy || !groups.length || !ui.patternError.hidden) {
		return
	}
	if (lastRun && !changes.length) {
		return
	}

	const more = changes.length > PREVIEW_LIMIT ? ` Showing the first ${PREVIEW_LIMIT}.` : ''
	const skipNote = skipped.length ? ` ${skipped.length} skipped.` : ''
	setStatus(changes.length
		? `${changes.length} photo${changes.length === 1 ? '' : 's'} will be renamed.${skipNote}${more}`
		: `Nothing to rename. The photos already have these names.${skipNote}`)
}

/**
 * Renames one file inside a folder handle. Uses move() where the browser has
 * it, otherwise copies to the new name and removes the original.
 */
async function renameInFolder(dir, from, to) {
	try {
		await dir.getFileHandle(to)
		throw new Error(`A file named ${to} already exists.`)
	} catch (error) {
		if (error.name !== 'NotFoundError') {
			throw error
		}
	}

	const handle = await dir.getFileHandle(from)
	if (typeof handle.move === 'function') {
		try {
			await handle.move(to)
			return
		} catch (error) {
			if (error.name !== 'NotSupportedError' && error.name !== 'TypeError') {
				throw error
			}
		}
	}

	const file = await handle.getFile()
	const target = await dir.getFileHandle(to, { create: true })
	const writable = await target.createWritable()
	await writable.write(file)
	await writable.close()
	await dir.removeEntry(from)
}

async function ensurePermission(dir) {
	if ((await dir.queryPermission({ mode: 'readwrite' })) === 'granted') {
		return true
	}
	return (await dir.requestPermission({ mode: 'readwrite' })) === 'granted'
}

async function runRenames(jobs) {
	setBusy(true)
	let total = 0
	try {
		for (const { group, renames } of jobs) {
			if (!(await ensurePermission(group.dir))) {
				throw new Error('Permission to change the folder was not given.')
			}
			total += await applyRenames(renames, (from, to) => renameInFolder(group.dir, from, to))

			// Keep our list in step with the folder.
			const newName = new Map(renames.map(item => [item.from, item.to]))
			for (const photo of group.photos) {
				photo.name = newName.get(photo.name) || photo.name
			}
			group.existing = group.existing.map(name => newName.get(name) || name)
		}
		return total
	} finally {
		setBusy(false)
	}
}

async function renameNow() {
	const jobs = plans.map(plan => ({ group: plan.group, renames: plan.renames.filter(item => item.from !== item.to) }))
	try {
		const total = await runRenames(jobs)
		lastRun = jobs
		update()
		setStatus(`Done: ${total} photo${total === 1 ? '' : 's'} renamed in “${groups[0].label}”.`, true)
	} catch (error) {
		update()
		setStatus(`Nothing was changed: ${error.message}`)
	}
}

async function undoNow() {
	if (!lastRun) {
		return
	}
	const jobs = lastRun.map(job => ({ group: job.group, renames: reverseRenames(job.renames) }))
	try {
		const total = await runRenames(jobs)
		lastRun = null
		update()
		setStatus(`Undone: ${total} photo${total === 1 ? '' : 's'} put back.`, true)
	} catch (error) {
		setStatus(`Could not undo: ${error.message}`)
	}
}

function loadScript(src) {
	return new Promise((resolve, reject) => {
		const script = document.createElement('script')
		script.src = src
		script.onload = resolve
		script.onerror = () => reject(new Error('Could not load the ZIP library. Check your connection.'))
		document.head.append(script)
	})
}

async function buildZip() {
	if (!window.JSZip) {
		await loadScript(JSZIP_URL)
	}
	const zip = new window.JSZip()
	for (const plan of plans) {
		const byName = new Map(plan.group.photos.map(photo => [photo.name, photo.file]))
		const folder = plan.group.path ? `${plan.group.path}/` : ''
		for (const item of plan.renames) {
			const file = byName.get(item.from)
			zip.file(folder + item.to, file, { date: new Date(file.lastModified) })
		}
	}
	return zip.generateAsync({ type: 'blob', compression: 'STORE' }, meta => {
		setStatus(`Making the ZIP… ${Math.round(meta.percent)}%`)
	})
}

async function downloadZip() {
	setBusy(true)
	try {
		const blob = await buildZip()
		const url = URL.createObjectURL(blob)
		const link = document.createElement('a')
		link.href = url
		link.download = 'renamed-photos.zip'
		document.body.append(link)
		link.click()
		link.remove()
		setTimeout(() => URL.revokeObjectURL(url), 60000)
		setStatus('Your ZIP of renamed photos is downloading. Your original files are unchanged.', true)
	} catch (error) {
		setStatus(`Could not make the ZIP: ${error.message}`)
	} finally {
		setBusy(false)
	}
}

function insertToken(token) {
	const input = ui.pattern
	if (!input.value) {
		input.value = input.placeholder
	}
	const start = input.selectionStart ?? input.value.length
	const end = input.selectionEnd ?? input.value.length
	input.value = input.value.slice(0, start) + token + input.value.slice(end)
	input.focus()
	input.setSelectionRange(start + token.length, start + token.length)
	update()
}

let updateTimer
const scheduleUpdate = () => {
	clearTimeout(updateTimer)
	updateTimer = setTimeout(update, 120)
}

ui.pickFolder.addEventListener('click', pickFolder)
ui.pickFolderFallback.addEventListener('change', event => loadFolderFiles(event.target.files))
ui.pickFiles.addEventListener('change', event => loadFiles(event.target.files))
for (const input of [ui.event, ui.pattern, ui.start]) {
	input.addEventListener('input', scheduleUpdate)
}
ui.useFileDate.addEventListener('change', update)
ui.rename.addEventListener('click', renameNow)
ui.download.addEventListener('click', downloadZip)
ui.undo.addEventListener('click', undoNow)
document.querySelector('.chips').addEventListener('click', event => {
	const chip = event.target.closest('[data-token]')
	if (chip) {
		insertToken(chip.dataset.token)
	}
})
