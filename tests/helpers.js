/**
 * Builds a small JPEG file whose EXIF says when it was taken.
 *
 * @param {string} dateTaken EXIF format, e.g. "2026:10:12 09:30:00".
 * @returns {Buffer}
 */
export function jpegWithDate(dateTaken) {
	// TIFF header + IFD0 (pointer to the Exif IFD) + Exif IFD (DateTimeOriginal), little-endian.
	const tiff = Buffer.alloc(64)
	tiff.write('II', 0, 'ascii')
	tiff.writeUInt16LE(42, 2)
	tiff.writeUInt32LE(8, 4) // IFD0 offset

	tiff.writeUInt16LE(1, 8) // one entry
	tiff.writeUInt16LE(0x8769, 10) // ExifIFDPointer
	tiff.writeUInt16LE(4, 12) // LONG
	tiff.writeUInt32LE(1, 14)
	tiff.writeUInt32LE(26, 18) // Exif IFD offset
	tiff.writeUInt32LE(0, 22) // no next IFD

	tiff.writeUInt16LE(1, 26) // one entry
	tiff.writeUInt16LE(0x9003, 28) // DateTimeOriginal
	tiff.writeUInt16LE(2, 30) // ASCII
	tiff.writeUInt32LE(20, 32)
	tiff.writeUInt32LE(44, 36) // value offset
	tiff.writeUInt32LE(0, 40)
	tiff.write(`${dateTaken}\0`, 44, 'ascii')

	const header = Buffer.from('Exif\0\0', 'binary')
	const length = Buffer.alloc(2)
	length.writeUInt16BE(2 + header.length + tiff.length)

	return Buffer.concat([
		Buffer.from([0xff, 0xd8]), // start of image
		Buffer.from([0xff, 0xe1]), length, header, tiff, // APP1 (EXIF)
		Buffer.from([0xff, 0xd9]), // end of image
	])
}
