package store

import (
	"encoding/json"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

const (
	RoleUser  = "user"
	RoleAdmin = "admin"
	// RoleAssistant is a message role only.
	RoleAssistant = "assistant"

	StatusPending = "pending"
	StatusActive  = "active"
	StatusBlocked = "blocked"

	MsgStreaming = "streaming"
	MsgComplete  = "complete"
	MsgStopped   = "stopped"
	MsgError     = "error"

	KindUpload    = "upload"
	KindGenerated = "generated"

	PartText       = "text"
	PartReasoning  = "reasoning"
	PartAttachment = "attachment"
	PartToolCall   = "tool_call"

	ToolQueued  = "queued"
	ToolRunning = "running"
	ToolDone    = "done"
	ToolError   = "error"
)

type Settings struct {
	CustomInstructions string `bson:"custom_instructions" json:"custom_instructions"`
	Theme              string `bson:"theme" json:"theme"`
}

type User struct {
	ID          bson.ObjectID `bson:"_id"`
	GoogleSub   string        `bson:"google_sub"`
	Email       string        `bson:"email"`
	Name        string        `bson:"name"`
	AvatarURL   string        `bson:"avatar_url"`
	Role        string        `bson:"role"`
	Status      string        `bson:"status"`
	Settings    Settings      `bson:"settings"`
	CreatedAt   time.Time     `bson:"created_at"`
	LastLoginAt time.Time     `bson:"last_login_at"`
}

type Session struct {
	ID        bson.ObjectID `bson:"_id"`
	TokenHash string        `bson:"token_hash"`
	UserID    bson.ObjectID `bson:"user_id"`
	UserAgent string        `bson:"user_agent"`
	IP        string        `bson:"ip"`
	CreatedAt time.Time     `bson:"created_at"`
	ExpiresAt time.Time     `bson:"expires_at"`
}

type Conversation struct {
	ID        bson.ObjectID `bson:"_id"`
	UserID    bson.ObjectID `bson:"user_id"`
	Title     string        `bson:"title"`
	Pinned    bool          `bson:"pinned"`
	CreatedAt time.Time     `bson:"created_at"`
	UpdatedAt time.Time     `bson:"updated_at"`
}

// FileRef is the API view of a file. Messages keep a snapshot of it in their parts.
type FileRef struct {
	ID        string `bson:"id" json:"id"`
	Kind      string `bson:"kind" json:"kind"`
	Name      string `bson:"name" json:"name"`
	Mime      string `bson:"mime" json:"mime"`
	Size      int64  `bson:"size" json:"size"`
	Width     int    `bson:"width,omitempty" json:"width,omitempty"`
	Height    int    `bson:"height,omitempty" json:"height,omitempty"`
	URL       string `bson:"url" json:"url"`
	Truncated bool   `bson:"truncated,omitempty" json:"truncated,omitempty"`
}

type ToolArgs struct {
	Prompt            string   `bson:"prompt" json:"prompt"`
	Size              string   `bson:"size,omitempty" json:"size,omitempty"`
	ReferenceImageIDs []string `bson:"reference_image_ids,omitempty" json:"reference_image_ids,omitempty"`
}

type ToolResult struct {
	File FileRef `bson:"file" json:"file"`
}

// Part is one entry of Message.parts; which fields are used depends on Type (docs/API.md#message).
type Part struct {
	Type string `bson:"type"`

	Text       string `bson:"text,omitempty"`
	DurationMS int64  `bson:"duration_ms,omitempty"`

	File *FileRef `bson:"file,omitempty"`

	ID     string      `bson:"id,omitempty"`
	Name   string      `bson:"name,omitempty"`
	Args   *ToolArgs   `bson:"args,omitempty"`
	Status string      `bson:"status,omitempty"`
	Result *ToolResult `bson:"result,omitempty"`
	Error  string      `bson:"error,omitempty"`
}

func (p Part) MarshalJSON() ([]byte, error) {
	switch p.Type {
	case PartText:
		return json.Marshal(struct {
			Type string `json:"type"`
			Text string `json:"text"`
		}{p.Type, p.Text})
	case PartReasoning:
		return json.Marshal(struct {
			Type       string `json:"type"`
			Text       string `json:"text"`
			DurationMS int64  `json:"duration_ms"`
		}{p.Type, p.Text, p.DurationMS})
	case PartAttachment:
		return json.Marshal(struct {
			Type string   `json:"type"`
			File *FileRef `json:"file"`
		}{p.Type, p.File})
	default:
		args := p.Args
		if args == nil {
			args = &ToolArgs{}
		}
		return json.Marshal(struct {
			Type   string      `json:"type"`
			ID     string      `json:"id"`
			Name   string      `json:"name"`
			Args   *ToolArgs   `json:"args"`
			Status string      `json:"status"`
			Result *ToolResult `json:"result,omitempty"`
			Error  string      `json:"error,omitempty"`
		}{p.Type, p.ID, p.Name, args, p.Status, p.Result, p.Error})
	}
}

type Usage struct {
	PromptTokens     int `bson:"prompt_tokens"`
	CompletionTokens int `bson:"completion_tokens"`
}

type MessageError struct {
	Code    string `bson:"code" json:"code"`
	Message string `bson:"message" json:"message"`
}

type Message struct {
	ID             bson.ObjectID `bson:"_id"`
	ConversationID bson.ObjectID `bson:"conversation_id"`
	UserID         bson.ObjectID `bson:"user_id"`
	Role           string        `bson:"role"`
	Status         string        `bson:"status"`
	Parts          []Part        `bson:"parts"`
	Usage          *Usage        `bson:"usage,omitempty"`
	Model          string        `bson:"model,omitempty"`
	LatencyMS      int64         `bson:"latency_ms,omitempty"`
	Error          *MessageError `bson:"error,omitempty"`
	CreatedAt      time.Time     `bson:"created_at"`
}

type File struct {
	ID             bson.ObjectID  `bson:"_id"`
	UserID         bson.ObjectID  `bson:"user_id"`
	ConversationID *bson.ObjectID `bson:"conversation_id"`
	Kind           string         `bson:"kind"`
	Mime           string         `bson:"mime"`
	Size           int64          `bson:"size"`
	Width          int            `bson:"width,omitempty"`
	Height         int            `bson:"height,omitempty"`
	Name           string         `bson:"name"`
	StorageKey     string         `bson:"storage_key"`
	ExtractedText  string         `bson:"extracted_text,omitempty"`
	Truncated      bool           `bson:"truncated,omitempty"`
	Prompt         string         `bson:"prompt,omitempty"`
	CreatedAt      time.Time      `bson:"created_at"`
}

func (f *File) IsImage() bool {
	return f.Mime == "image/png" || f.Mime == "image/jpeg" || f.Mime == "image/webp"
}

func (f *File) Ref() FileRef {
	return FileRef{
		ID:        f.ID.Hex(),
		Kind:      f.Kind,
		Name:      f.Name,
		Mime:      f.Mime,
		Size:      f.Size,
		Width:     f.Width,
		Height:    f.Height,
		URL:       "/api/files/" + f.ID.Hex(),
		Truncated: f.Truncated,
	}
}

// FileListItem is a FileRef plus when the file was created, for the image/document libraries.
type FileListItem struct {
	FileRef
	CreatedAt time.Time `json:"created_at"`
}

func (f *File) ListItem() FileListItem {
	return FileListItem{FileRef: f.Ref(), CreatedAt: f.CreatedAt}
}

type AuditLog struct {
	ID        bson.ObjectID `bson:"_id"`
	ActorID   bson.ObjectID `bson:"actor_id"`
	Action    string        `bson:"action"`
	TargetID  bson.ObjectID `bson:"target_id"`
	Meta      bson.M        `bson:"meta,omitempty"`
	CreatedAt time.Time     `bson:"created_at"`
}
