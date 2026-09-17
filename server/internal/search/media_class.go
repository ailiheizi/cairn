package search

import (
	"fmt"
	"strings"
)

// Media-class projection over the entry's recorded filename suffix.
//
// A media class is a derived, rebuildable projection — not identity, not a
// durable fact, and not recovery evidence. It is computed from exactly one
// fact the daemon already records: the suffix the lexical feed carries for an
// entry (`suffixOf(entry.DisplayName)` in indexer.go, the filename's final
// extension lowercased). It never reads file bytes, the meaning of the name,
// the path, the size, or the free-text detection field, and it never changes a
// subject, a protection decision, or a digest. Rebuilding the lexical
// generation reproduces the same class from the same recorded suffix, and
// dropping the generation drops the projection with it: there is no durable
// column and no new table behind it.
//
// Unknown stays unknown. An entry whose suffix is not recorded (a name with no
// extension) has no class at all: it does not match any media_class filter,
// including "other". "other" means the daemon recorded a suffix that this one
// table does not classify; it never means "we could not tell".
//
// The suffix table below is the single definitions table. Suffix groups follow
// the IANA media type registry conventions catalogued by mime-db: the class is
// the top-level type of the registered media type — image/* is image, video/*
// is video, audio/* is audio, application/pdf, text/*, the OpenDocument
// (application/vnd.oasis.opendocument.*), the OOXML (application/vnd.
// openxmlformats-officedocument.*), the legacy MS Office and the registered
// e-book types are document, and the registered archive, compression and
// disk-image container types (application/zip, application/x-tar,
// application/gzip, application/x-7z-compressed, ...) are archive. A suffix
// absent from the table is "other" regardless of how it looks.

const (
	MediaClassImage    = "image"
	MediaClassVideo    = "video"
	MediaClassAudio    = "audio"
	MediaClassDocument = "document"
	MediaClassArchive  = "archive"
	MediaClassOther    = "other"
)

// MediaClasses is the closed media-class filter vocabulary in report order.
var MediaClasses = []string{
	MediaClassImage, MediaClassVideo, MediaClassAudio,
	MediaClassDocument, MediaClassArchive, MediaClassOther,
}

// mediaClassSuffixes maps one recorded, lowercased suffix (without the dot) to
// its media class. It is the only definitions table; MediaClassOf is the only
// derive function.
var mediaClassSuffixes = map[string]string{
	// image: registered image/* types.
	"jpg": MediaClassImage, "jpeg": MediaClassImage, "jpe": MediaClassImage,
	"jfif": MediaClassImage, "png": MediaClassImage, "gif": MediaClassImage,
	"bmp": MediaClassImage, "webp": MediaClassImage, "avif": MediaClassImage,
	"heic": MediaClassImage, "heif": MediaClassImage, "tif": MediaClassImage,
	"tiff": MediaClassImage, "svg": MediaClassImage, "ico": MediaClassImage,
	"jxl": MediaClassImage, "jp2": MediaClassImage, "j2k": MediaClassImage,
	"ppm": MediaClassImage, "pgm": MediaClassImage, "pbm": MediaClassImage,
	"pnm": MediaClassImage, "exr": MediaClassImage, "dds": MediaClassImage,
	"tga": MediaClassImage, "hdr": MediaClassImage, "psd": MediaClassImage,
	"xcf": MediaClassImage, "raw": MediaClassImage, "cr2": MediaClassImage,
	"cr3": MediaClassImage, "nef": MediaClassImage, "arw": MediaClassImage,
	"dng": MediaClassImage, "orf": MediaClassImage, "rw2": MediaClassImage,
	"raf": MediaClassImage, "srw": MediaClassImage, "pef": MediaClassImage,

	// video: registered video/* types. `.ts` is the registered video/mp2t
	// transport stream, not a source-code fact.
	"mp4": MediaClassVideo, "m4v": MediaClassVideo, "mov": MediaClassVideo,
	"qt": MediaClassVideo, "mkv": MediaClassVideo, "webm": MediaClassVideo,
	"avi": MediaClassVideo, "wmv": MediaClassVideo, "asf": MediaClassVideo,
	"flv": MediaClassVideo, "f4v": MediaClassVideo, "mpg": MediaClassVideo,
	"mpeg": MediaClassVideo, "mpe": MediaClassVideo, "m2v": MediaClassVideo,
	"ts": MediaClassVideo, "mts": MediaClassVideo, "m2ts": MediaClassVideo,
	"3gp": MediaClassVideo, "3g2": MediaClassVideo, "ogv": MediaClassVideo,
	"vob": MediaClassVideo,

	// audio: registered audio/* types.
	"mp3": MediaClassAudio, "m4a": MediaClassAudio, "m4b": MediaClassAudio,
	"aac": MediaClassAudio, "flac": MediaClassAudio, "wav": MediaClassAudio,
	"wave": MediaClassAudio, "ogg": MediaClassAudio, "oga": MediaClassAudio,
	"opus": MediaClassAudio, "wma": MediaClassAudio, "aiff": MediaClassAudio,
	"aif": MediaClassAudio, "aifc": MediaClassAudio, "mid": MediaClassAudio,
	"midi": MediaClassAudio, "amr": MediaClassAudio, "ac3": MediaClassAudio,
	"dts": MediaClassAudio, "mka": MediaClassAudio, "au": MediaClassAudio,
	"caf": MediaClassAudio,

	// document: application/pdf, text/*, OpenDocument, OOXML, the legacy MS
	// Office types, and the registered e-book types.
	"pdf": MediaClassDocument, "txt": MediaClassDocument, "text": MediaClassDocument,
	"conf": MediaClassDocument, "ini": MediaClassDocument, "log": MediaClassDocument,
	"md": MediaClassDocument, "markdown": MediaClassDocument, "rtf": MediaClassDocument,
	"doc": MediaClassDocument, "docx": MediaClassDocument, "docm": MediaClassDocument,
	"dot": MediaClassDocument, "dotx": MediaClassDocument, "odt": MediaClassDocument,
	"ott": MediaClassDocument, "xls": MediaClassDocument, "xlsx": MediaClassDocument,
	"xlsm": MediaClassDocument, "xlsb": MediaClassDocument, "ods": MediaClassDocument,
	"ots": MediaClassDocument, "csv": MediaClassDocument, "tsv": MediaClassDocument,
	"ppt": MediaClassDocument, "pptx": MediaClassDocument, "pptm": MediaClassDocument,
	"pps": MediaClassDocument, "ppsx": MediaClassDocument, "odp": MediaClassDocument,
	"otp": MediaClassDocument, "epub": MediaClassDocument, "mobi": MediaClassDocument,
	"azw": MediaClassDocument, "azw3": MediaClassDocument, "fb2": MediaClassDocument,
	"tex": MediaClassDocument, "html": MediaClassDocument, "htm": MediaClassDocument,
	"xhtml": MediaClassDocument, "xml": MediaClassDocument, "json": MediaClassDocument,
	"yaml": MediaClassDocument, "yml": MediaClassDocument, "toml": MediaClassDocument,

	// archive: registered archive, compression, and disk-image containers.
	"zip": MediaClassArchive, "rar": MediaClassArchive, "7z": MediaClassArchive,
	"tar": MediaClassArchive, "gz": MediaClassArchive, "tgz": MediaClassArchive,
	"bz2": MediaClassArchive, "tbz": MediaClassArchive, "tbz2": MediaClassArchive,
	"xz": MediaClassArchive, "txz": MediaClassArchive, "zst": MediaClassArchive,
	"lz": MediaClassArchive, "lzma": MediaClassArchive, "lz4": MediaClassArchive,
	"cab": MediaClassArchive, "iso": MediaClassArchive, "dmg": MediaClassArchive,
	"jar": MediaClassArchive, "war": MediaClassArchive, "ear": MediaClassArchive,
	"apk": MediaClassArchive, "deb": MediaClassArchive, "rpm": MediaClassArchive,
	"cpio": MediaClassArchive, "ar": MediaClassArchive,
}

// MediaClassOf derives the media class of one recorded suffix. The suffix is
// normalized (trimmed, lowercased, leading dot removed) because the filter may
// be compared against either the stored column or a caller-supplied value. An
// empty suffix has no class and returns ""; a recorded suffix outside the
// table returns "other".
func MediaClassOf(suffix string) string {
	normalized := NormalizeSuffix(suffix)
	if normalized == "" {
		return ""
	}
	if class, ok := mediaClassSuffixes[normalized]; ok {
		return class
	}
	return MediaClassOther
}

// NormalizeSuffix is the one suffix normalization used by the media-class
// projection: trim, lowercase, drop one leading dot.
func NormalizeSuffix(suffix string) string {
	return strings.TrimPrefix(strings.ToLower(strings.TrimSpace(suffix)), ".")
}

// NormalizeMediaClass validates one media_class filter value. An empty value is
// an absent constraint. A value outside the closed vocabulary is rejected so a
// typo can never become a silently empty result.
func NormalizeMediaClass(value string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized == "" {
		return "", nil
	}
	for _, allowed := range MediaClasses {
		if normalized == allowed {
			return normalized, nil
		}
	}
	return "", fmt.Errorf("media_class %q is not one of %s", value, strings.Join(MediaClasses, ", "))
}
