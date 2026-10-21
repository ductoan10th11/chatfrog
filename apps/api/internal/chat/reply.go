package chat

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

// imageLabel matches the "[image id=...]" labels of the conversation history.
var imageLabel = regexp.MustCompile(`\[image id=[^\]]*\]`)

// closingPunct may follow a wrapping pair, e.g. `[abc].` or `"abc"!`.
const closingPunct = ".,!?;:…。"

// cleanReply tidies the one-sentence reply written after an image: it drops image labels
// and strips one pair of wrapping brackets or quotes that the small model sometimes adds.
func cleanReply(s string) string {
	s = imageLabel.ReplaceAllString(s, "")
	s = strings.TrimSpace(s)
	s = unwrap(s, '[', ']')
	s = unwrap(s, '"', '"')
	s = unwrap(s, '“', '”')
	return strings.Join(strings.Fields(s), " ")
}

// unwrap removes one pair of open/closeR delimiters that wrap the whole of s. Only
// punctuation may follow the closing delimiter. Brackets nest; quotes end at the first closer.
func unwrap(s string, open, closeR rune) string {
	first, size := utf8.DecodeRuneInString(s)
	if size == 0 || first != open {
		return s
	}
	depth := 1
	end := -1
	for i, r := range s[size:] {
		if r == open && open != closeR {
			depth++
		} else if r == closeR {
			depth--
			if depth == 0 {
				end = size + i
				break
			}
		}
	}
	if end < 0 {
		return s
	}
	tail := s[end+utf8.RuneLen(closeR):]
	if strings.Trim(tail, closingPunct) != "" {
		return s
	}
	return strings.TrimSpace(s[size:end]) + tail
}
