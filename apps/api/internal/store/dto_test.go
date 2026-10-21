package store

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestMessageJSONEmptyParts(t *testing.T) {
	for _, parts := range [][]Part{nil, {}} {
		b, err := json.Marshal((&Message{Parts: parts}).JSON())
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(b), `"parts":[]`) {
			t.Errorf("parts must be an empty array: %s", b)
		}
	}
}
