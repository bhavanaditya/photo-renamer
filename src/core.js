/**
 * Photo Renamer core.
 *
 * Works out new names for a set of photos from the date each one was taken,
 * and applies the renames safely. Shared by the command-line tool and the
 * web app, so it uses no Node.js or browser APIs.
 */

export const PHOTO_EXTENSIONS = [
	'jpg', 'jpeg', 'heic', 'heif', 'png', 'webp', 'tif', 'tiff',
	'dng', 'cr2', 'cr3', 'nef', 'arw', 'orf', 'rw2', 'raf',
]

export const TOKENS = ['date', 'time', 'year', 'month', 'day', 'hour', 'minute', 'second', 'n', 'name', 'event']

export const DEFAULT_PATTERN = '{date}_{n}'
export const DEFAULT_EVENT_PATTERN = '{date}_{event}_{n}'

// EXIF fields that hold the date a photo was taken, best first.
export const DATE_FIELDS = ['DateTimeOriginal', 'CreateDate', 'DateTimeDigitized']

export function extensionOf(name) {
	const dot = name.lastIndexOf('.')
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function baseName(name) {
	const dot = name.lastIndexOf('.')
	return dot > 0 ? name.slice(0, dot) : name
}

export function isPhoto(name) {
	return !name.startsWith('.') && PHOTO_EXTENSIONS.includes(extensionOf(name))
}

/**
 * Picks the date taken from parsed EXIF data, or null.
 */
export function dateFromExif(exif) {
	if (!exif) {
		return null
	}
	for (const field of DATE_FIELDS) {
		const value = exif[field]
		if (value instanceof Date && !isNaN(value)) {
			return value
		}
	}
	return null
}

/**
 * Makes text safe for a file name: removes characters that are not allowed
 * on Windows or macOS and turns spaces into hyphens.
 */
export function cleanPart(text) {
	return String(text || '')
		.trim()
		.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '')
		.replace(/\s+/g, '-')
}

export function validatePattern(pattern) {
	if (!pattern || !pattern.trim()) {
		throw new Error('The pattern is empty.')
	}
	if (/[/\\]/.test(pattern)) {
		throw new Error('The pattern cannot contain / or \\.')
	}
	for (const match of pattern.matchAll(/\{([^}]*)\}/g)) {
		if (!TOKENS.includes(match[1])) {
			throw new Error(`Unknown placeholder {${match[1]}}. You can use: ${TOKENS.map(t => `{${t}}`).join(' ')}`)
		}
	}
}

function pad(value, length = 2) {
	return String(value).padStart(length, '0')
}

/**
 * Fills in a pattern such as "{date}_{event}_{n}" for one photo.
 */
export function formatName(pattern, { date, n, digits = 3, name = '', event = '' }) {
	const values = {
		date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
		time: `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`,
		year: String(date.getFullYear()),
		month: pad(date.getMonth() + 1),
		day: pad(date.getDate()),
		hour: pad(date.getHours()),
		minute: pad(date.getMinutes()),
		second: pad(date.getSeconds()),
		n: pad(n, digits),
		name: cleanPart(name),
		event: cleanPart(event),
	}

	return pattern
		.replace(/\{([a-z]+)\}/g, (_, token) => values[token])
		// An empty {event} or {name} leaves doubled separators behind: "2026-10-12__001".
		.replace(/([_\- ])[_\- ]+/g, '$1')
		.replace(/^[_\- .]+|[_\- .]+$/g, '')
}

/**
 * Works out the new name for every photo.
 *
 * @param {Array<{name: string, date: Date|null, fileDate?: Date|null}>} photos
 *   `date` is the date taken from the photo itself, `fileDate` the file's modified date.
 * @param {object}   [options]
 * @param {string}   [options.pattern]      Defaults to "{date}_{n}", or "{date}_{event}_{n}" with an event.
 * @param {string}   [options.event]        Text for {event}, e.g. "Goa Trip".
 * @param {number}   [options.start=1]      First number for {n}.
 * @param {number}   [options.digits]       Width of {n}. Defaults to 3, or more for big sets.
 * @param {boolean}  [options.useFileDate]  Use the file's date when a photo has none. Default true.
 * @param {string[]} [options.existing]     Every file name in the folder, to avoid clashes.
 * @returns {{pattern: string, renames: Array<{from: string, to: string, date: Date, source: string}>, skipped: Array<{name: string, reason: string}>}}
 */
export function planRenames(photos, options = {}) {
	const event = cleanPart(options.event)
	const pattern = options.pattern || (event ? DEFAULT_EVENT_PATTERN : DEFAULT_PATTERN)
	validatePattern(pattern)

	const useFileDate = options.useFileDate !== false
	const start = Number.isInteger(options.start) && options.start >= 0 ? options.start : 1

	const dated = []
	const skipped = []
	for (const photo of photos) {
		const taken = photo.date && !isNaN(photo.date) ? photo.date : null
		const fallback = useFileDate && photo.fileDate && !isNaN(photo.fileDate) ? photo.fileDate : null
		if (!taken && !fallback) {
			skipped.push({ name: photo.name, reason: 'no date found' })
			continue
		}
		dated.push({ name: photo.name, when: taken || fallback, source: taken ? 'photo' : 'file' })
	}

	dated.sort((a, b) => a.when - b.when || a.name.localeCompare(b.name, undefined, { numeric: true }))

	const digits = options.digits || Math.max(3, String(start + dated.length - 1).length)

	// Names in use by other files. The photos' own names are free, since they are being renamed.
	const taken = new Set((options.existing || []).map(name => name.toLowerCase()))
	dated.forEach(photo => taken.delete(photo.name.toLowerCase()))

	const renames = dated.map((photo, index) => {
		const ext = extensionOf(photo.name)
		const stem = formatName(pattern, { date: photo.when, n: start + index, digits, name: baseName(photo.name), event }) || 'photo'

		let to = `${stem}.${ext}`
		for (let copy = 2; taken.has(to.toLowerCase()); copy++) {
			to = `${stem}-${copy}.${ext}`
		}
		taken.add(to.toLowerCase())

		return { from: photo.name, to, date: photo.when, source: photo.source }
	})

	return { pattern, renames, skipped }
}

/**
 * Renames files in two steps (first to temporary names, then to the final
 * names), so swaps like a -> b and b -> a work. If anything fails, the
 * renames already done are rolled back.
 *
 * @param {Array<{from: string, to: string}>} renames
 * @param {(from: string, to: string) => Promise<void>} rename
 * @returns {Promise<number>} How many files were renamed.
 */
export async function applyRenames(renames, rename) {
	const todo = renames.filter(item => item.from !== item.to)
	const token = Math.random().toString(36).slice(2, 8)
	const temps = todo.map((_, index) => `.photo-renamer-${token}-${index}.tmp`)
	const done = []

	try {
		for (let i = 0; i < todo.length; i++) {
			await rename(todo[i].from, temps[i])
			done.push([todo[i].from, temps[i]])
		}
		for (let i = 0; i < todo.length; i++) {
			await rename(temps[i], todo[i].to)
			done.push([temps[i], todo[i].to])
		}
	} catch (error) {
		for (const [from, to] of done.reverse()) {
			try {
				await rename(to, from)
			} catch {
				// Keep rolling back the rest.
			}
		}
		throw error
	}

	return todo.length
}

/**
 * The renames that put files back the way they were.
 */
export function reverseRenames(renames) {
	return renames.filter(item => item.from !== item.to).map(item => ({ from: item.to, to: item.from }))
}
