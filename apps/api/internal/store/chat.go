package store

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

/* ---------------------------------------------------------------- conversations */

func (s *Store) CreateConversation(ctx context.Context, userID bson.ObjectID, title string) (*Conversation, error) {
	t := now()
	c := &Conversation{ID: bson.NewObjectID(), UserID: userID, Title: title, CreatedAt: t, UpdatedAt: t}
	if _, err := s.conversations.InsertOne(ctx, c); err != nil {
		return nil, err
	}
	return c, nil
}

func (s *Store) GetConversation(ctx context.Context, userID, id bson.ObjectID) (*Conversation, error) {
	var c Conversation
	if err := s.conversations.FindOne(ctx, bson.M{"_id": id, "user_id": userID}).Decode(&c); err != nil {
		return nil, notFound(err)
	}
	return &c, nil
}

// ListConversations sorts pinned first, then by updated_at desc. With q, matches the title
// (substring) or any message text (Mongo text index).
func (s *Store) ListConversations(ctx context.Context, userID bson.ObjectID, q string, offset, limit int) ([]Conversation, bool, error) {
	filter := bson.M{"user_id": userID}
	if q != "" {
		or := bson.A{bson.M{"title": containsRegex(q)}}
		ids, err := s.searchConversationIDs(ctx, userID, q)
		if err != nil {
			return nil, false, err
		}
		if len(ids) > 0 {
			or = append(or, bson.M{"_id": bson.M{"$in": ids}})
		}
		filter["$or"] = or
	}
	opts := options.Find().
		SetSort(bson.D{{Key: "pinned", Value: -1}, {Key: "updated_at", Value: -1}, {Key: "_id", Value: -1}}).
		SetSkip(int64(offset)).SetLimit(int64(limit + 1))
	cur, err := s.conversations.Find(ctx, filter, opts)
	if err != nil {
		return nil, false, err
	}
	var out []Conversation
	if err := cur.All(ctx, &out); err != nil {
		return nil, false, err
	}
	more := len(out) > limit
	if more {
		out = out[:limit]
	}
	return out, more, nil
}

func (s *Store) searchConversationIDs(ctx context.Context, userID bson.ObjectID, q string) ([]bson.ObjectID, error) {
	var out []bson.ObjectID
	err := s.messages.Distinct(ctx, "conversation_id",
		bson.M{"user_id": userID, "$text": bson.M{"$search": q}}).Decode(&out)
	return out, err
}

func (s *Store) UpdateConversation(ctx context.Context, userID, id bson.ObjectID, set bson.M) (*Conversation, error) {
	var c Conversation
	err := s.conversations.FindOneAndUpdate(ctx, bson.M{"_id": id, "user_id": userID}, bson.M{"$set": set},
		options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&c)
	if err != nil {
		return nil, notFound(err)
	}
	return &c, nil
}

func (s *Store) TouchConversation(ctx context.Context, id bson.ObjectID) error {
	_, err := s.conversations.UpdateByID(ctx, id, bson.M{"$set": bson.M{"updated_at": now()}})
	return err
}

// SetTitleIfEmpty sets the title unless the user already named the conversation.
func (s *Store) SetTitleIfEmpty(ctx context.Context, id bson.ObjectID, title string) (bool, error) {
	res, err := s.conversations.UpdateOne(ctx, bson.M{"_id": id, "title": ""}, bson.M{"$set": bson.M{"title": title}})
	if err != nil {
		return false, err
	}
	return res.ModifiedCount > 0, nil
}

// DeleteConversation removes the conversation and its messages, and returns its files
// (already removed from the db) so the caller can delete their bytes.
func (s *Store) DeleteConversation(ctx context.Context, userID, id bson.ObjectID) ([]File, error) {
	res, err := s.conversations.DeleteOne(ctx, bson.M{"_id": id, "user_id": userID})
	if err != nil {
		return nil, err
	}
	if res.DeletedCount == 0 {
		return nil, ErrNotFound
	}
	if _, err := s.messages.DeleteMany(ctx, bson.M{"conversation_id": id}); err != nil {
		return nil, err
	}
	filter := bson.M{"conversation_id": id, "user_id": userID}
	cur, err := s.files.Find(ctx, filter)
	if err != nil {
		return nil, err
	}
	var files []File
	if err := cur.All(ctx, &files); err != nil {
		return nil, err
	}
	if _, err := s.files.DeleteMany(ctx, filter); err != nil {
		return nil, err
	}
	return files, nil
}

/* ---------------------------------------------------------------- messages */

func (s *Store) InsertMessage(ctx context.Context, m *Message) error {
	if m.ID.IsZero() {
		m.ID = bson.NewObjectID()
	}
	if m.CreatedAt.IsZero() {
		m.CreatedAt = now()
	}
	if m.Parts == nil {
		m.Parts = []Part{}
	}
	_, err := s.messages.InsertOne(ctx, m)
	return err
}

func (s *Store) GetMessage(ctx context.Context, userID, id bson.ObjectID) (*Message, error) {
	var m Message
	if err := s.messages.FindOne(ctx, bson.M{"_id": id, "user_id": userID}).Decode(&m); err != nil {
		return nil, notFound(err)
	}
	return &m, nil
}

// ListMessagesPage returns up to `limit` messages older than `before` (newest page when
// zero), in ascending order, and whether older ones exist.
func (s *Store) ListMessagesPage(ctx context.Context, convID, before bson.ObjectID, limit int) ([]Message, bool, error) {
	filter := bson.M{"conversation_id": convID}
	if !before.IsZero() {
		filter["_id"] = bson.M{"$lt": before}
	}
	opts := options.Find().SetSort(bson.D{{Key: "_id", Value: -1}}).SetLimit(int64(limit + 1))
	cur, err := s.messages.Find(ctx, filter, opts)
	if err != nil {
		return nil, false, err
	}
	var out []Message
	if err := cur.All(ctx, &out); err != nil {
		return nil, false, err
	}
	more := len(out) > limit
	if more {
		out = out[:limit]
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, more, nil
}

// ListMessages returns every message of a conversation with _id < before (all when zero), ascending.
func (s *Store) ListMessages(ctx context.Context, convID, before bson.ObjectID) ([]Message, error) {
	filter := bson.M{"conversation_id": convID}
	if !before.IsZero() {
		filter["_id"] = bson.M{"$lt": before}
	}
	cur, err := s.messages.Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "_id", Value: 1}}))
	if err != nil {
		return nil, err
	}
	var out []Message
	return out, cur.All(ctx, &out)
}

func (s *Store) LastMessage(ctx context.Context, convID bson.ObjectID) (*Message, error) {
	var m Message
	err := s.messages.FindOne(ctx, bson.M{"conversation_id": convID},
		options.FindOne().SetSort(bson.D{{Key: "_id", Value: -1}})).Decode(&m)
	if err != nil {
		return nil, notFound(err)
	}
	return &m, nil
}

func (s *Store) DeleteMessage(ctx context.Context, id bson.ObjectID) error {
	_, err := s.messages.DeleteOne(ctx, bson.M{"_id": id})
	return err
}

func (s *Store) DeleteMessagesAfter(ctx context.Context, convID, id bson.ObjectID) error {
	_, err := s.messages.DeleteMany(ctx, bson.M{"conversation_id": convID, "_id": bson.M{"$gt": id}})
	return err
}

func (s *Store) SetMessageParts(ctx context.Context, id bson.ObjectID, parts []Part) error {
	_, err := s.messages.UpdateByID(ctx, id, bson.M{"$set": bson.M{"parts": parts}})
	return err
}

// FinishMessage stores the final state of an assistant message.
func (s *Store) FinishMessage(ctx context.Context, m *Message) error {
	set := bson.M{"parts": m.Parts, "status": m.Status, "model": m.Model, "latency_ms": m.LatencyMS}
	if m.Usage != nil {
		set["usage"] = m.Usage
	}
	if m.Error != nil {
		set["error"] = m.Error
	}
	_, err := s.messages.UpdateByID(ctx, m.ID, bson.M{"$set": set})
	return err
}

// MarkInterrupted fixes messages left `streaming` by a crash or restart.
func (s *Store) MarkInterrupted(ctx context.Context) (int64, error) {
	res, err := s.messages.UpdateMany(ctx, bson.M{"status": MsgStreaming}, bson.M{"$set": bson.M{
		"status": MsgError,
		"error":  MessageError{Code: "internal", Message: "Máy chủ đã khởi động lại khi đang tạo câu trả lời"},
	}})
	if err != nil {
		return 0, err
	}
	return res.ModifiedCount, nil
}

func (s *Store) FileUsedInMessage(ctx context.Context, fileID string) (bool, error) {
	n, err := s.messages.CountDocuments(ctx, bson.M{"$or": bson.A{
		bson.M{"parts.file.id": fileID},
		bson.M{"parts.result.file.id": fileID},
	}}, options.Count().SetLimit(1))
	return n > 0, err
}

/* ---------------------------------------------------------------- files */

func (s *Store) InsertFile(ctx context.Context, f *File) error {
	if f.ID.IsZero() {
		f.ID = bson.NewObjectID()
	}
	f.CreatedAt = now()
	_, err := s.files.InsertOne(ctx, f)
	return err
}

func (s *Store) GetFile(ctx context.Context, userID, id bson.ObjectID) (*File, error) {
	var f File
	if err := s.files.FindOne(ctx, bson.M{"_id": id, "user_id": userID}).Decode(&f); err != nil {
		return nil, notFound(err)
	}
	return &f, nil
}

// ListFiles returns the user's files that belong to a conversation, newest first: images when
// `images` is set, every other file (documents) otherwise.
func (s *Store) ListFiles(ctx context.Context, userID bson.ObjectID, images bool, offset, limit int) ([]File, bool, error) {
	imageMimes := bson.A{"image/png", "image/jpeg", "image/webp"}
	mime := bson.M{"$nin": imageMimes}
	if images {
		mime = bson.M{"$in": imageMimes}
	}
	filter := bson.M{"user_id": userID, "conversation_id": bson.M{"$ne": nil}, "mime": mime}
	opts := options.Find().
		SetSort(bson.D{{Key: "created_at", Value: -1}, {Key: "_id", Value: -1}}).
		SetSkip(int64(offset)).SetLimit(int64(limit + 1))
	cur, err := s.files.Find(ctx, filter, opts)
	if err != nil {
		return nil, false, err
	}
	var out []File
	if err := cur.All(ctx, &out); err != nil {
		return nil, false, err
	}
	more := len(out) > limit
	if more {
		out = out[:limit]
	}
	return out, more, nil
}

func (s *Store) GetFiles(ctx context.Context, userID bson.ObjectID, ids []bson.ObjectID) ([]File, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	cur, err := s.files.Find(ctx, bson.M{"_id": bson.M{"$in": ids}, "user_id": userID})
	if err != nil {
		return nil, err
	}
	var out []File
	return out, cur.All(ctx, &out)
}

// AttachFiles links not-yet-linked uploads to a conversation (so they are deleted with it).
func (s *Store) AttachFiles(ctx context.Context, ids []bson.ObjectID, convID bson.ObjectID) error {
	if len(ids) == 0 {
		return nil
	}
	_, err := s.files.UpdateMany(ctx, bson.M{"_id": bson.M{"$in": ids}, "conversation_id": nil},
		bson.M{"$set": bson.M{"conversation_id": convID}})
	return err
}

func (s *Store) DeleteFile(ctx context.Context, id bson.ObjectID) error {
	_, err := s.files.DeleteOne(ctx, bson.M{"_id": id})
	return err
}

// OrphanUploads returns uploads never attached to a conversation and older than `age`.
func (s *Store) OrphanUploads(ctx context.Context, age time.Duration) ([]File, error) {
	cur, err := s.files.Find(ctx, bson.M{
		"kind": KindUpload, "conversation_id": nil, "created_at": bson.M{"$lt": time.Now().Add(-age)},
	}, options.Find().SetLimit(500))
	if err != nil {
		return nil, err
	}
	var out []File
	return out, cur.All(ctx, &out)
}
