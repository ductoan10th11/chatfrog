package store

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

type DayStats struct {
	Date             string `json:"date"`
	Messages         int64  `json:"messages"`
	Images           int64  `json:"images"`
	PromptTokens     int64  `json:"prompt_tokens"`
	CompletionTokens int64  `json:"completion_tokens"`
	AvgLatencyMS     int64  `json:"avg_latency_ms"`
}

type Totals struct {
	Users         int64 `json:"users"`
	ActiveUsers   int64 `json:"active_users"`
	Conversations int64 `json:"conversations"`
	Messages      int64 `json:"messages"`
	Images        int64 `json:"images"`
	StorageBytes  int64 `json:"storage_bytes"`
}

// DailyStats aggregates [from, to] (inclusive days in loc). Every day is present, zeros included.
func (s *Store) DailyStats(ctx context.Context, from, to time.Time, loc *time.Location) ([]DayStats, error) {
	start := time.Date(from.Year(), from.Month(), from.Day(), 0, 0, 0, 0, loc)
	end := time.Date(to.Year(), to.Month(), to.Day(), 0, 0, 0, 0, loc).AddDate(0, 0, 1)
	day := bson.M{"$dateToString": bson.M{"format": "%Y-%m-%d", "date": "$created_at", "timezone": loc.String()}}
	inRange := bson.M{"created_at": bson.M{"$gte": start, "$lt": end}}

	type msgRow struct {
		Day          string `bson:"_id"`
		Messages     int64  `bson:"messages"`
		Prompt       int64  `bson:"prompt"`
		Completion   int64  `bson:"completion"`
		LatencySum   int64  `bson:"latency_sum"`
		LatencyCount int64  `bson:"latency_count"`
	}
	var msgRows []msgRow
	if err := aggregate(ctx, s.messages, &msgRows, mongo.Pipeline{
		{{Key: "$match", Value: inRange}},
		{{Key: "$group", Value: bson.M{
			"_id":        day,
			"messages":   bson.M{"$sum": bson.M{"$cond": bson.A{bson.M{"$eq": bson.A{"$role", RoleUser}}, 1, 0}}},
			"prompt":     bson.M{"$sum": bson.M{"$ifNull": bson.A{"$usage.prompt_tokens", 0}}},
			"completion": bson.M{"$sum": bson.M{"$ifNull": bson.A{"$usage.completion_tokens", 0}}},
			"latency_sum": bson.M{"$sum": bson.M{"$cond": bson.A{
				bson.M{"$gt": bson.A{"$latency_ms", 0}}, "$latency_ms", 0}}},
			"latency_count": bson.M{"$sum": bson.M{"$cond": bson.A{bson.M{"$gt": bson.A{"$latency_ms", 0}}, 1, 0}}},
		}}},
	}); err != nil {
		return nil, err
	}

	type imgRow struct {
		Day    string `bson:"_id"`
		Images int64  `bson:"images"`
	}
	var imgRows []imgRow
	if err := aggregate(ctx, s.files, &imgRows, mongo.Pipeline{
		{{Key: "$match", Value: bson.M{"kind": KindGenerated, "created_at": inRange["created_at"]}}},
		{{Key: "$group", Value: bson.M{"_id": day, "images": bson.M{"$sum": 1}}}},
	}); err != nil {
		return nil, err
	}

	byDay := map[string]*DayStats{}
	var out []DayStats
	for d := start; d.Before(end); d = d.AddDate(0, 0, 1) {
		out = append(out, DayStats{Date: d.Format("2006-01-02")})
	}
	for i := range out {
		byDay[out[i].Date] = &out[i]
	}
	for _, r := range msgRows {
		if d := byDay[r.Day]; d != nil {
			d.Messages, d.PromptTokens, d.CompletionTokens = r.Messages, r.Prompt, r.Completion
			if r.LatencyCount > 0 {
				d.AvgLatencyMS = r.LatencySum / r.LatencyCount
			}
		}
	}
	for _, r := range imgRows {
		if d := byDay[r.Day]; d != nil {
			d.Images = r.Images
		}
	}
	return out, nil
}

func (s *Store) Totals(ctx context.Context) (Totals, error) {
	var t Totals
	var err error
	count := func(c *mongo.Collection, filter bson.M) int64 {
		if err != nil {
			return 0
		}
		var n int64
		n, err = c.CountDocuments(ctx, filter)
		return n
	}
	t.Users = count(s.users, bson.M{})
	t.ActiveUsers = count(s.users, bson.M{"status": StatusActive})
	t.Conversations = count(s.conversations, bson.M{})
	t.Messages = count(s.messages, bson.M{"role": RoleUser})
	t.Images = count(s.files, bson.M{"kind": KindGenerated})
	if err != nil {
		return t, err
	}
	var rows []struct {
		Bytes int64 `bson:"bytes"`
	}
	if err := aggregate(ctx, s.files, &rows, mongo.Pipeline{
		{{Key: "$group", Value: bson.M{"_id": nil, "bytes": bson.M{"$sum": "$size"}}}},
	}); err != nil {
		return t, err
	}
	if len(rows) > 0 {
		t.StorageBytes = rows[0].Bytes
	}
	return t, nil
}

// UserCounts returns user messages and generated images per user.
func (s *Store) UserCounts(ctx context.Context, ids []bson.ObjectID) (messages, images map[bson.ObjectID]int64, err error) {
	type row struct {
		ID    bson.ObjectID `bson:"_id"`
		Count int64         `bson:"count"`
	}
	group := bson.D{{Key: "$group", Value: bson.M{"_id": "$user_id", "count": bson.M{"$sum": 1}}}}
	toMap := func(rows []row) map[bson.ObjectID]int64 {
		m := make(map[bson.ObjectID]int64, len(rows))
		for _, r := range rows {
			m[r.ID] = r.Count
		}
		return m
	}
	var msgRows, imgRows []row
	if err = aggregate(ctx, s.messages, &msgRows, mongo.Pipeline{
		{{Key: "$match", Value: bson.M{"user_id": bson.M{"$in": ids}, "role": RoleUser}}}, group,
	}); err != nil {
		return nil, nil, err
	}
	if err = aggregate(ctx, s.files, &imgRows, mongo.Pipeline{
		{{Key: "$match", Value: bson.M{"user_id": bson.M{"$in": ids}, "kind": KindGenerated}}}, group,
	}); err != nil {
		return nil, nil, err
	}
	return toMap(msgRows), toMap(imgRows), nil
}

func aggregate(ctx context.Context, c *mongo.Collection, out any, p mongo.Pipeline) error {
	cur, err := c.Aggregate(ctx, p)
	if err != nil {
		return err
	}
	return cur.All(ctx, out)
}
