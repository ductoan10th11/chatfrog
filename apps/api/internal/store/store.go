// Package store is the MongoDB repository (collections in docs/SPEC.md §7).
package store

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

var ErrNotFound = errors.New("not found")

type Store struct {
	client        *mongo.Client
	db            *mongo.Database
	users         *mongo.Collection
	sessions      *mongo.Collection
	conversations *mongo.Collection
	messages      *mongo.Collection
	files         *mongo.Collection
	auditLogs     *mongo.Collection
}

func Connect(ctx context.Context, uri, dbName string) (*Store, error) {
	client, err := mongo.Connect(options.Client().ApplyURI(uri).SetAppName("chatfrog-api"))
	if err != nil {
		return nil, err
	}
	pingCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if err := client.Ping(pingCtx, nil); err != nil {
		_ = client.Disconnect(context.Background())
		return nil, fmt.Errorf("mongo ping: %w", err)
	}
	db := client.Database(dbName)
	return &Store{
		client:        client,
		db:            db,
		users:         db.Collection("users"),
		sessions:      db.Collection("sessions"),
		conversations: db.Collection("conversations"),
		messages:      db.Collection("messages"),
		files:         db.Collection("files"),
		auditLogs:     db.Collection("audit_logs"),
	}, nil
}

func (s *Store) Close(ctx context.Context) error { return s.client.Disconnect(ctx) }

func (s *Store) Ping(ctx context.Context) error { return s.client.Ping(ctx, nil) }

// DropDatabase is used by the end-to-end test on its throwaway database.
func (s *Store) DropDatabase(ctx context.Context) error { return s.db.Drop(ctx) }

func (s *Store) EnsureIndexes(ctx context.Context) error {
	// Fresh builders per index: the driver writes the generated name into them.
	unique := func() *options.IndexOptionsBuilder { return options.Index().SetUnique(true) }
	textNone := func() *options.IndexOptionsBuilder { return options.Index().SetDefaultLanguage("none") }
	specs := map[*mongo.Collection][]mongo.IndexModel{
		s.users: {
			{Keys: bson.D{{Key: "google_sub", Value: 1}}, Options: unique()},
			{Keys: bson.D{{Key: "email", Value: 1}}, Options: unique()},
		},
		s.sessions: {
			{Keys: bson.D{{Key: "token_hash", Value: 1}}, Options: unique()},
			{Keys: bson.D{{Key: "user_id", Value: 1}}},
			{Keys: bson.D{{Key: "expires_at", Value: 1}}, Options: options.Index().SetExpireAfterSeconds(0)},
		},
		s.conversations: {
			{Keys: bson.D{{Key: "user_id", Value: 1}, {Key: "pinned", Value: -1}, {Key: "updated_at", Value: -1}}},
			{Keys: bson.D{{Key: "title", Value: "text"}}, Options: textNone()},
		},
		s.messages: {
			{Keys: bson.D{{Key: "conversation_id", Value: 1}, {Key: "_id", Value: 1}}},
			{Keys: bson.D{{Key: "user_id", Value: 1}, {Key: "created_at", Value: 1}}},
			{Keys: bson.D{{Key: "parts.text", Value: "text"}}, Options: textNone()},
		},
		s.files: {
			{Keys: bson.D{{Key: "user_id", Value: 1}, {Key: "created_at", Value: 1}}},
			{Keys: bson.D{{Key: "conversation_id", Value: 1}}},
			{Keys: bson.D{{Key: "user_id", Value: 1}, {Key: "created_at", Value: -1}}},
		},
		s.auditLogs: {
			{Keys: bson.D{{Key: "created_at", Value: 1}}},
		},
	}
	for coll, models := range specs {
		if _, err := coll.Indexes().CreateMany(ctx, models); err != nil {
			return fmt.Errorf("indexes %s: %w", coll.Name(), err)
		}
	}
	return nil
}

func notFound(err error) error {
	if errors.Is(err, mongo.ErrNoDocuments) {
		return ErrNotFound
	}
	return err
}

func now() time.Time { return time.Now().UTC().Truncate(time.Millisecond) }

func containsRegex(q string) bson.Regex {
	return bson.Regex{Pattern: regexp.QuoteMeta(q), Options: "i"}
}

/* ---------------------------------------------------------------- users */

func (s *Store) GetUser(ctx context.Context, id bson.ObjectID) (*User, error) {
	var u User
	if err := s.users.FindOne(ctx, bson.M{"_id": id}).Decode(&u); err != nil {
		return nil, notFound(err)
	}
	return &u, nil
}

func (s *Store) FindUserByGoogle(ctx context.Context, sub, email string) (*User, error) {
	var u User
	err := s.users.FindOne(ctx, bson.M{"$or": bson.A{bson.M{"google_sub": sub}, bson.M{"email": email}}}).Decode(&u)
	if err != nil {
		return nil, notFound(err)
	}
	return &u, nil
}

func (s *Store) CreateUser(ctx context.Context, u *User) error {
	u.ID = bson.NewObjectID()
	u.CreatedAt = now()
	_, err := s.users.InsertOne(ctx, u)
	return err
}

// UpdateUser applies `set` and returns the updated user.
func (s *Store) UpdateUser(ctx context.Context, id bson.ObjectID, set bson.M) (*User, error) {
	var u User
	err := s.users.FindOneAndUpdate(ctx, bson.M{"_id": id}, bson.M{"$set": set},
		options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&u)
	if err != nil {
		return nil, notFound(err)
	}
	return &u, nil
}

// ListUsers returns one page (offset based) plus whether more rows exist.
func (s *Store) ListUsers(ctx context.Context, status, q string, offset, limit int) ([]User, bool, error) {
	filter := bson.M{}
	if status != "" {
		filter["status"] = status
	}
	if q != "" {
		filter["$or"] = bson.A{bson.M{"email": containsRegex(q)}, bson.M{"name": containsRegex(q)}}
	}
	opts := options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}, {Key: "_id", Value: -1}}).
		SetSkip(int64(offset)).SetLimit(int64(limit + 1))
	cur, err := s.users.Find(ctx, filter, opts)
	if err != nil {
		return nil, false, err
	}
	var out []User
	if err := cur.All(ctx, &out); err != nil {
		return nil, false, err
	}
	more := len(out) > limit
	if more {
		out = out[:limit]
	}
	return out, more, nil
}

/* ---------------------------------------------------------------- sessions */

func (s *Store) CreateSession(ctx context.Context, sess *Session) error {
	sess.ID = bson.NewObjectID()
	sess.CreatedAt = now()
	_, err := s.sessions.InsertOne(ctx, sess)
	return err
}

func (s *Store) GetSession(ctx context.Context, tokenHash string) (*Session, error) {
	var sess Session
	err := s.sessions.FindOne(ctx, bson.M{"token_hash": tokenHash, "expires_at": bson.M{"$gt": time.Now()}}).Decode(&sess)
	if err != nil {
		return nil, notFound(err)
	}
	return &sess, nil
}

func (s *Store) ExtendSession(ctx context.Context, id bson.ObjectID, expiresAt time.Time) error {
	_, err := s.sessions.UpdateByID(ctx, id, bson.M{"$set": bson.M{"expires_at": expiresAt}})
	return err
}

func (s *Store) DeleteSession(ctx context.Context, tokenHash string) error {
	_, err := s.sessions.DeleteOne(ctx, bson.M{"token_hash": tokenHash})
	return err
}

func (s *Store) DeleteUserSessions(ctx context.Context, userID bson.ObjectID) error {
	_, err := s.sessions.DeleteMany(ctx, bson.M{"user_id": userID})
	return err
}

/* ---------------------------------------------------------------- audit */

func (s *Store) Audit(ctx context.Context, actor bson.ObjectID, action string, target bson.ObjectID, meta bson.M) error {
	_, err := s.auditLogs.InsertOne(ctx, AuditLog{
		ID: bson.NewObjectID(), ActorID: actor, Action: action, TargetID: target, Meta: meta, CreatedAt: now(),
	})
	return err
}
