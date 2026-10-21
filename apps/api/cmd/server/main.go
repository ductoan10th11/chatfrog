// Command server runs the ChatFrog api (docs/SPEC.md §5).
package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"chatfrog/api/internal/admin"
	"chatfrog/api/internal/auth"
	"chatfrog/api/internal/chat"
	"chatfrog/api/internal/config"
	"chatfrog/api/internal/files"
	"chatfrog/api/internal/httpapi"
	"chatfrog/api/internal/provider"
	"chatfrog/api/internal/store"
	"chatfrog/api/internal/tools"
)

var version = "dev"

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))
	if err := run(); err != nil {
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	st, err := store.Connect(ctx, cfg.MongoURI, cfg.MongoDB)
	if err != nil {
		return err
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = st.Close(closeCtx)
	}()
	if err := st.EnsureIndexes(ctx); err != nil {
		return err
	}
	if n, err := st.MarkInterrupted(ctx); err != nil {
		return err
	} else if n > 0 {
		slog.Warn("marked interrupted generations", "count", n)
	}

	storage, err := files.NewStorage(cfg.FilesDir)
	if err != nil {
		return err
	}
	llm := provider.NewLLM(cfg.LLMBaseURL, cfg.LLMAPIKey, cfg.LLMModel)
	img := provider.NewImage(cfg.ImageBaseURL, cfg.ImageAPIKey, cfg.ImageModel)
	monitor := admin.NewMonitor(llm, img, st)
	imageTool := tools.NewImageTool(st, storage, img, cfg.ImageTimeout)
	imageTool.OnResult = func(err error) { monitor.Record("image", err) }

	chatSvc := chat.New(cfg, st, storage, llm, imageTool, monitor)
	api := httpapi.New(cfg, st, storage, auth.New(cfg, st), chatSvc, monitor)

	go cleanOrphans(ctx, st, storage)

	// Cancelled on shutdown so running generations stop and are saved as "stopped".
	baseCtx, cancelRequests := context.WithCancel(context.Background())
	defer cancelRequests()
	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		BaseContext:       func(net.Listener) context.Context { return baseCtx },
		Handler:           api.Router(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       2 * time.Minute,
		IdleTimeout:       2 * time.Minute,
		// No WriteTimeout: SSE streams last as long as a generation.
	}
	errCh := make(chan error, 1)
	go func() {
		slog.Info("listening", "addr", cfg.HTTPAddr, "version", version, "db", cfg.MongoDB,
			"llm", cfg.LLMModel, "image", cfg.ImageModel, "origin", cfg.AppOrigin)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
	}
	slog.Info("shutting down")
	shutCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	cancelRequests()
	return srv.Shutdown(shutCtx)
}

// cleanOrphans removes uploads that were never sent in a message (hourly, after 24 h).
func cleanOrphans(ctx context.Context, st *store.Store, storage *files.Storage) {
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		list, err := st.OrphanUploads(ctx, 24*time.Hour)
		if err != nil {
			slog.Warn("orphan uploads", "err", err)
			continue
		}
		for _, f := range list {
			if err := st.DeleteFile(ctx, f.ID); err == nil {
				storage.Remove(f.StorageKey, f.ID.Hex())
			}
		}
		if len(list) > 0 {
			slog.Info("removed orphan uploads", "count", len(list))
		}
	}
}
