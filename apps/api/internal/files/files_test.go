package files

import (
	"archive/zip"
	"bytes"
	"image"
	"image/png"
	"testing"
)

func pngBytes(t *testing.T, w, h int) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, w, h))); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestSniff(t *testing.T) {
	docx := func() []byte {
		var b bytes.Buffer
		zw := zip.NewWriter(&b)
		f, _ := zw.Create("word/document.xml")
		f.Write([]byte(`<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Xin</w:t></w:r><w:r><w:tab/><w:t>chào</w:t></w:r></w:p><w:p><w:r><w:t>ếch</w:t></w:r></w:p></w:body></w:document>`))
		zw.Close()
		return b.Bytes()
	}()

	cases := []struct {
		name    string
		data    []byte
		mime    string
		isImage bool
		fail    bool
	}{
		{"a.png", pngBytes(t, 2, 2), "image/png", true, false},
		{"fake.png", []byte("not an image"), "", false, true},
		{"notes.md", []byte("# Tiêu đề\nnội dung"), "text/markdown; charset=utf-8", false, false},
		{"bin.txt", []byte{0, 1, 2}, "", false, true},
		{"run.exe", []byte("MZ...."), "", false, true},
		{"doc.docx", docx, docxMime, false, false},
		{"doc.zip", docx, "", false, true},
	}
	for _, c := range cases {
		mime, isImage, err := Sniff(c.name, c.data)
		if (err != nil) != c.fail || mime != c.mime || isImage != c.isImage {
			t.Errorf("%s: mime=%q image=%v err=%v", c.name, mime, isImage, err)
		}
	}

	text, truncated, err := ExtractText(docxMime, docx, 100)
	if err != nil || text != "Xin\tchào\nếch" || truncated {
		t.Errorf("docx text = %q truncated=%v err=%v", text, truncated, err)
	}
}

func TestExtractTextTruncates(t *testing.T) {
	text, truncated, err := ExtractText("text/plain; charset=utf-8", []byte("\uFEFFếch ếch ếch"), 5)
	if err != nil || text != "ếch ế" || !truncated {
		t.Errorf("text=%q truncated=%v err=%v", text, truncated, err)
	}
}

func TestFitJPEG(t *testing.T) {
	out, err := FitJPEG(pngBytes(t, 2000, 1000), 384, 80)
	if err != nil {
		t.Fatal(err)
	}
	w, h, err := ImageSize(out)
	if err != nil || w != 384 || h != 192 {
		t.Errorf("size %dx%d err=%v", w, h, err)
	}
	// Never upscales.
	out, _ = FitJPEG(pngBytes(t, 100, 50), 384, 80)
	if w, h, _ := ImageSize(out); w != 100 || h != 50 {
		t.Errorf("upscaled to %dx%d", w, h)
	}
}
