package provider

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strings"
)

type Image struct{ client }

func NewImage(baseURL, apiKey, model string) *Image {
	return &Image{newClient(baseURL, apiKey, model)}
}

const maxImageBytes = 64 << 20

func (im *Image) Generate(ctx context.Context, prompt, size string) ([]byte, error) {
	payload, err := json.Marshal(map[string]any{
		"model": im.model, "prompt": prompt, "size": size, "n": 1, "response_format": "b64_json",
	})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, im.baseURL+"/images/generations", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	return im.send(ctx, req)
}

// Edit sends the reference images as `image` (one) or `image[]` (several), like the OpenAI API.
func (im *Image) Edit(ctx context.Context, prompt, size string, images []ImageInput) ([]byte, error) {
	if len(images) == 0 {
		return nil, errors.New("edit needs at least one image")
	}
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	for k, v := range map[string]string{
		"model": im.model, "prompt": prompt, "size": size, "n": "1", "response_format": "b64_json",
	} {
		if err := w.WriteField(k, v); err != nil {
			return nil, err
		}
	}
	field := "image"
	if len(images) > 1 {
		field = "image[]"
	}
	for _, img := range images {
		h := make(textproto.MIMEHeader)
		h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="%s"`, field, img.Name))
		h.Set("Content-Type", img.Mime)
		part, err := w.CreatePart(h)
		if err != nil {
			return nil, err
		}
		if _, err := part.Write(img.Data); err != nil {
			return nil, err
		}
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, im.baseURL+"/images/edits", &body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	return im.send(ctx, req)
}

func (im *Image) send(ctx context.Context, req *http.Request) ([]byte, error) {
	res, err := im.do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	var out struct {
		Data []struct {
			B64JSON string `json:"b64_json"`
			URL     string `json:"url"`
		} `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, maxImageBytes*2)).Decode(&out); err != nil {
		return nil, fmt.Errorf("image response: %w", err)
	}
	if len(out.Data) == 0 {
		return nil, errors.New("image server returned no image")
	}
	if b := out.Data[0].B64JSON; b != "" {
		if i := strings.Index(b, ","); strings.HasPrefix(b, "data:") && i > 0 {
			b = b[i+1:]
		}
		return base64.StdEncoding.DecodeString(b)
	}
	if out.Data[0].URL == "" {
		return nil, errors.New("image server returned neither b64_json nor url")
	}
	get, err := http.NewRequestWithContext(ctx, http.MethodGet, out.Data[0].URL, nil)
	if err != nil {
		return nil, err
	}
	// No Authorization header: the URL may point to another host.
	imgRes, err := im.http.Do(get)
	if err != nil {
		return nil, err
	}
	defer imgRes.Body.Close()
	if imgRes.StatusCode/100 != 2 {
		return nil, &APIError{Status: imgRes.StatusCode, Body: "image download failed"}
	}
	return io.ReadAll(io.LimitReader(imgRes.Body, maxImageBytes))
}
