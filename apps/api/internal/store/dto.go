package store

import "time"

// JSON views matching docs/API.md#kiểu-dữ-liệu.

type UserJSON struct {
	ID          string    `json:"id"`
	Email       string    `json:"email"`
	Name        string    `json:"name"`
	AvatarURL   *string   `json:"avatar_url"`
	Role        string    `json:"role"`
	Status      string    `json:"status"`
	Settings    Settings  `json:"settings"`
	CreatedAt   time.Time `json:"created_at"`
	LastLoginAt time.Time `json:"last_login_at"`
}

func (u *User) JSON() UserJSON {
	var avatar *string
	if u.AvatarURL != "" {
		avatar = &u.AvatarURL
	}
	settings := u.Settings
	if settings.Theme == "" {
		settings.Theme = "system"
	}
	return UserJSON{
		ID: u.ID.Hex(), Email: u.Email, Name: u.Name, AvatarURL: avatar, Role: u.Role, Status: u.Status,
		Settings: settings, CreatedAt: u.CreatedAt.UTC(), LastLoginAt: u.LastLoginAt.UTC(),
	}
}

type ConversationJSON struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Pinned    bool      `json:"pinned"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (c *Conversation) JSON() ConversationJSON {
	return ConversationJSON{
		ID: c.ID.Hex(), Title: c.Title, Pinned: c.Pinned, CreatedAt: c.CreatedAt.UTC(), UpdatedAt: c.UpdatedAt.UTC(),
	}
}

type MessageJSON struct {
	ID             string        `json:"id"`
	ConversationID string        `json:"conversation_id"`
	Role           string        `json:"role"`
	Status         string        `json:"status"`
	Parts          []Part        `json:"parts"`
	Error          *MessageError `json:"error,omitempty"`
	CreatedAt      time.Time     `json:"created_at"`
}

func (m *Message) JSON() MessageJSON {
	// A copy (the generation keeps mutating m.Parts), never nil: the API sends `[]`, not `null`.
	parts := make([]Part, len(m.Parts))
	copy(parts, m.Parts)
	return MessageJSON{
		ID: m.ID.Hex(), ConversationID: m.ConversationID.Hex(), Role: m.Role, Status: m.Status,
		Parts: parts, Error: m.Error, CreatedAt: m.CreatedAt.UTC(),
	}
}
