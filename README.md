# Photo Renamer

[![Tests](https://github.com/bhavanaditya/photo-renamer/actions/workflows/tests.yml/badge.svg)](https://github.com/bhavanaditya/photo-renamer/actions/workflows/tests.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Rename your photos by the date they were taken, so they sort in order everywhere.

```text
IMG_4521.HEIC        ->  2026-10-11_Goa-Trip_001.heic
IMG_4522.HEIC        ->  2026-10-12_Goa-Trip_002.heic
DSC_0007.JPG         ->  2026-10-13_Goa-Trip_003.jpg
Screenshot 2026.png  ->  2026-10-14_Goa-Trip_004.png
```

Phone cameras, WhatsApp and cameras all name photos differently, so a folder from one trip ends up out of order. Photo Renamer reads the date each photo was taken and gives every file a clear name.

It comes in two forms that share the same naming rules:

- **[Web app](https://bhavanaditya.github.io/photo-renamer/)**: nothing to install. Works on any device, and your photos never leave it.
- **Command-line tool**: for big folders of thousands of photos, with preview and undo.

## Features

- Reads the date taken from the photo's EXIF data: JPG, HEIC (iPhone), PNG, WebP, TIFF and camera RAW (DNG, CR2, CR3, NEF, ARW, ORF, RW2, RAF)
- Uses the file's date for photos without one, like screenshots, or skips them if you prefer
- Your own naming pattern, with an optional event or place name
- Numbers photos in the order they were taken
- Never overwrites another file: clashing names get `-2`, `-3` added
- Preview before anything changes, and undo afterwards
- Renames safely, even when names swap (a → b and b → a), and rolls back if something fails

## Web app

Open **[bhavanaditya.github.io/photo-renamer](https://bhavanaditya.github.io/photo-renamer/)**, choose a folder or some photos, check the preview and rename.

| Browser | What happens |
| --- | --- |
| Chrome or Edge on a computer | Photos are renamed right in the folder you choose. You can undo straight away. |
| Safari, Firefox, phones and tablets | You get a ZIP of renamed copies. Your originals stay as they are. |

Everything runs in your browser. Photos are not uploaded anywhere.

## Command-line tool

### Install

You need [Node.js](https://nodejs.org/) 18.18 or newer.

```bash
git clone https://github.com/bhavanaditya/photo-renamer.git
cd photo-renamer
npm install
npm link    # makes the photo-renamer command available everywhere
```

### Use

Preview first. Nothing changes until you add `--apply`:

```bash
photo-renamer ~/Pictures/Goa --event "Goa Trip"
```

```text
/Users/me/Pictures/Goa
  IMG_4521.HEIC        ->  2026-10-11_Goa-Trip_001.heic
  IMG_4522.HEIC        ->  2026-10-12_Goa-Trip_002.heic
  Screenshot 2026.png  ->  2026-10-14_Goa-Trip_003.png   (file date)

Preview: 3 photo(s) would be renamed. Nothing has changed yet. Add --apply to rename them.
```

Then rename for real:

```bash
photo-renamer ~/Pictures/Goa --event "Goa Trip" --apply
```

Changed your mind? Put the old names back:

```bash
photo-renamer ~/Pictures/Goa --undo
```

### Options

| Option | What it does | Default |
| --- | --- | --- |
| `-p`, `--pattern TEXT` | How to name the files (see below) | `{date}_{n}`, or `{date}_{event}_{n}` with an event |
| `-e`, `--event TEXT` | Text for `{event}`, e.g. `"Goa Trip"` | none |
| `--start N` | First number for `{n}` | `1` |
| `--digits N` | Width of `{n}`, e.g. `4` gives `0001` | `3`, more for big folders |
| `-r`, `--recursive` | Also rename photos in subfolders. Each folder is numbered separately | off |
| `--no-file-date` | Skip photos without a date taken, instead of using the file's date | off |
| `-a`, `--apply` | Rename the files. Without it, you only see a preview | off |
| `--undo` | Put back the names from the last `--apply` in that folder | |
| `-h`, `--help` | Show help | |
| `-v`, `--version` | Show the version | |

Put quotes around anything with spaces, like `--event "Goa Trip"`.

### Patterns

| Placeholder | Example | Meaning |
| --- | --- | --- |
| `{date}` | `2026-10-12` | Date taken |
| `{time}` | `093000` | Time taken (hours, minutes, seconds) |
| `{year}` `{month}` `{day}` | `2026` `10` `12` | Parts of the date |
| `{hour}` `{minute}` `{second}` | `09` `30` `00` | Parts of the time |
| `{n}` | `001` | Number, in the order the photos were taken |
| `{event}` | `Goa-Trip` | The `--event` text, with spaces turned into hyphens |
| `{name}` | `IMG_4521` | The original name, without the extension |

A few ideas:

```bash
photo-renamer . --pattern "{date}_{time}"            # 2026-10-12_093000.jpg
photo-renamer . --pattern "{year}{month}{day}_{n}"   # 20261012_001.jpg
photo-renamer . --pattern "{date}_{name}"            # 2026-10-12_IMG_4521.jpg
```

The file extension is kept, in lower case.

### How undo works

Each `--apply` writes a small `.photo-renamer-log.json` file in the folder, listing every rename. `--undo` reads it, puts the old names back and deletes the log. Only the most recent run in each folder can be undone.

## Good to know

- **Dates:** the date and time are the camera's local time, as stored in the photo.
- **Videos** are not renamed yet.
- **Live Photos:** an iPhone Live Photo's video part (`.MOV`) keeps its name, so it may no longer sit next to its photo.
- **Back up first** if the photos matter. Renaming doesn't change the photos themselves, but it's always wise.

## Development

```bash
npm install
npm test
```

| Path | What's there |
| --- | --- |
| `src/core.js` | Naming rules and safe renaming, shared by both versions |
| `bin/photo-renamer.js` | The command-line tool |
| `web/` | The web app (`web/core.js` links to `src/core.js`) |
| `tests/` | Tests for the naming rules and the command-line tool |

To try the web app locally, serve the `web` folder, for example with `npx serve web`, and open the address it shows.

Pushes to `main` publish the web app to GitHub Pages automatically.

## License

[MIT](LICENSE)

## Author

**Bhavanaditya D R** · [bhavanaditya.com](https://www.bhavanaditya.com/) · [LinkedIn](https://www.linkedin.com/in/drbhavanaditya/)
