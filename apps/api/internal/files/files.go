// Package files stores uploads and generated images, sniffs types, extracts document text
// and resizes images.
package files

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ledongthuc/pdf"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

var ErrUnsupported = errors.New("unsupported file type")

const (
	MaxImageBytes = 10 << 20
	maxPixels     = 50_000_000
	ThumbPx       = 384
)

// Storage keeps file bytes at <dir>/<yyyy>/<mm>/<id>; names never come from user input.
type Storage struct{ dir string }

func NewStorage(dir string) (*Storage, error) {
	if err := os.MkdirAll(filepath.Join(dir, "thumbs"), 0o750); err != nil {
		return nil, err
	}
	return &Storage{dir: dir}, nil
}

func (s *Storage) Save(id string, at time.Time, data []byte) (string, error) {
	key := filepath.Join(at.UTC().Format("2006"), at.UTC().Format("01"), id)
	path := filepath.Join(s.dir, key)
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return "", err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o640); err != nil {
		return "", err
	}
	return key, os.Rename(tmp, path)
}

func (s *Storage) Path(key string) string { return filepath.Join(s.dir, filepath.Clean("/"+key)) }

func (s *Storage) Read(key string) ([]byte, error) { return os.ReadFile(s.Path(key)) }

func (s *Storage) ThumbPath(id string) string { return filepath.Join(s.dir, "thumbs", id+".jpg") }

func (s *Storage) Remove(key, id string) {
	_ = os.Remove(s.Path(key))
	_ = os.Remove(s.ThumbPath(id))
}

/* ---------------------------------------------------------------- sniffing */

var textExt = map[string]string{
	".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv", ".json": "application/json",
	".ts": "text/plain", ".tsx": "text/plain", ".js": "text/plain", ".jsx": "text/plain",
	".py": "text/plain", ".go": "text/plain", ".rs": "text/plain", ".java": "text/plain",
	".c": "text/plain", ".cpp": "text/plain", ".h": "text/plain", ".sh": "text/plain",
	".yaml": "text/plain", ".yml": "text/plain", ".html": "text/plain", ".css": "text/plain",
	".sql": "text/plain", ".log": "text/plain", ".xml": "text/plain", ".toml": "text/plain",
}

const docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

// Sniff decides the mime type from the bytes (and, for plain text, the extension).
// The client's Content-Type is never trusted.
func Sniff(name string, data []byte) (mime string, isImage bool, err error) {
	switch detected := http.DetectContentType(data); detected {
	case "image/png", "image/jpeg", "image/webp":
		return detected, true, nil
	case "application/pdf":
		return detected, false, nil
	case "application/zip":
		if strings.EqualFold(filepath.Ext(name), ".docx") && zipHas(data, "word/document.xml") {
			return docxMime, false, nil
		}
		return "", false, ErrUnsupported
	}
	if m, ok := textExt[strings.ToLower(filepath.Ext(name))]; ok && isText(data) {
		return m + "; charset=utf-8", false, nil
	}
	return "", false, ErrUnsupported
}

func isText(data []byte) bool {
	sample := data[:min(len(data), 8192)]
	if bytes.IndexByte(sample, 0) >= 0 {
		return false
	}
	// The sample may cut a multi-byte rune at its end.
	for len(sample) > 0 && !utf8.Valid(sample) && len(data) > len(sample) {
		sample = sample[:len(sample)-1]
	}
	return utf8.Valid(sample)
}

func zipHas(data []byte, name string) bool {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return false
	}
	for _, f := range zr.File {
		if f.Name == name {
			return true
		}
	}
	return false
}

/* ---------------------------------------------------------------- text extraction */

// ExtractText returns the document text cut at maxChars runes, and whether it was cut.
func ExtractText(mime string, data []byte, maxChars int) (string, bool, error) {
	var text string
	var err error
	switch {
	case mime == "application/pdf":
		text, err = pdfText(data)
	case mime == docxMime:
		text, err = docxText(data)
	default:
		text = strings.TrimPrefix(string(data), "\uFEFF")
		text = strings.ToValidUTF8(text, "")
	}
	if err != nil {
		return "", false, err
	}
	text = strings.TrimSpace(text)
	if utf8.RuneCountInString(text) <= maxChars {
		return text, false, nil
	}
	return string([]rune(text)[:maxChars]), true, nil
}

func pdfText(data []byte) (text string, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("pdf: %v", r)
		}
	}()
	r, err := pdf.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", fmt.Errorf("pdf: %w", err)
	}
	rd, err := r.GetPlainText()
	if err != nil {
		return "", fmt.Errorf("pdf: %w", err)
	}
	b, err := io.ReadAll(io.LimitReader(rd, 8<<20))
	if err != nil {
		return "", fmt.Errorf("pdf: %w", err)
	}
	return string(b), nil
}

func docxText(data []byte) (string, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", fmt.Errorf("docx: %w", err)
	}
	for _, f := range zr.File {
		if f.Name != "word/document.xml" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return "", fmt.Errorf("docx: %w", err)
		}
		defer rc.Close()
		var sb strings.Builder
		dec := xml.NewDecoder(io.LimitReader(rc, 64<<20))
		inText := false
		for {
			tok, err := dec.Token()
			if errors.Is(err, io.EOF) {
				break
			}
			if err != nil {
				return "", fmt.Errorf("docx: %w", err)
			}
			switch t := tok.(type) {
			case xml.StartElement:
				switch t.Name.Local {
				case "t":
					inText = true
				case "tab":
					sb.WriteByte('\t')
				case "br":
					sb.WriteByte('\n')
				}
			case xml.EndElement:
				switch t.Name.Local {
				case "t":
					inText = false
				case "p":
					sb.WriteByte('\n')
				}
			case xml.CharData:
				if inText {
					sb.Write(t)
				}
			}
		}
		return sb.String(), nil
	}
	return "", errors.New("docx: word/document.xml not found")
}

/* ---------------------------------------------------------------- images */

// ImageSize reads the dimensions without decoding the pixels.
func ImageSize(data []byte) (w, h int, err error) {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return 0, 0, err
	}
	if cfg.Width*cfg.Height > maxPixels {
		return 0, 0, errors.New("image too large")
	}
	return cfg.Width, cfg.Height, nil
}

// FitJPEG scales the image so its longest side is <= maxPx (never upscales) and encodes JPEG.
// Transparent areas become white.
func FitJPEG(data []byte, maxPx, quality int) ([]byte, error) {
	if _, _, err := ImageSize(data); err != nil {
		return nil, err
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if longest := max(w, h); longest > maxPx {
		w = max(1, w*maxPx/longest)
		h = max(1, h*maxPx/longest)
	}
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(dst, dst.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, b, draw.Over, nil)
	var out bytes.Buffer
	if err := jpeg.Encode(&out, dst, &jpeg.Options{Quality: quality}); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}
