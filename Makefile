# ChatFrog — xem `make help`

SHELL := /bin/bash
.DEFAULT_GOAL := help

FRONTEND := frontend
BACKEND  := backend
VERSION  ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)

ENV_FILE ?= .env
COMPOSE  := podman compose -f deploy/compose.yaml --env-file $(ENV_FILE)
API_IMAGE := localhost/chatfrog-api:$(VERSION)

WEB_ROOT   ?= /srv/chatfrog/web
BACKUP_DIR ?= ./backups

##@ Chung
.PHONY: help
help: ## Liệt kê các lệnh
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z0-9_-]+:.*?##/ { printf "  \033[32m%-16s\033[0m %s\n", $$1, $$2 } /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) }' $(MAKEFILE_LIST)

.PHONY: install install-fe install-be
install: install-fe install-be ## Cài dependency frontend + backend
install-fe:
	cd $(FRONTEND) && npm ci
install-be:
	cd $(BACKEND) && go mod download

##@ Phát triển
.PHONY: dev dev-fe dev-mock dev-be db-up db-down
dev: db-up ## Chạy frontend + backend song song
	$(MAKE) -j2 dev-fe dev-be
dev-fe: ## Chạy frontend (Vite)
	cd $(FRONTEND) && npm run dev
dev-mock: ## Chạy frontend với MSW mock API (không cần backend)
	cd $(FRONTEND) && VITE_MOCK=1 npm run dev
dev-be: ## Chạy backend (đọc .env)
	cd $(BACKEND) && set -a && source ../$(ENV_FILE) && set +a && go run ./cmd/server
db-up: ## Khởi động MongoDB (podman)
	$(COMPOSE) up -d mongo
db-down: ## Dừng MongoDB
	$(COMPOSE) stop mongo

##@ Chất lượng
.PHONY: fmt lint lint-fe lint-be test test-fe test-be check
fmt: ## Format code
	cd $(FRONTEND) && npx prettier --write .
	cd $(BACKEND) && gofmt -w . && go mod tidy
lint: lint-fe lint-be ## Lint toàn bộ
lint-fe:
	cd $(FRONTEND) && npm run lint && npx tsc --noEmit
lint-be:
	cd $(BACKEND) && go vet ./...
test: test-fe test-be ## Chạy test toàn bộ
test-fe:
	cd $(FRONTEND) && npm test -- --run
test-be:
	cd $(BACKEND) && go test -race ./...
check: lint test ## Lint + test (chạy trước khi commit)

##@ Build
.PHONY: build build-fe build-be image
build: build-fe build-be ## Build frontend + backend
build-fe: ## Build frontend → frontend/dist
	cd $(FRONTEND) && npm run build
build-be: ## Build binary backend → backend/bin/chatfrog
	cd $(BACKEND) && CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=$(VERSION)" -o bin/chatfrog ./cmd/server
image: ## Build container image cho api
	podman build -t $(API_IMAGE) -t localhost/chatfrog-api:latest -f deploy/Containerfile.api $(BACKEND)

##@ Triển khai
.PHONY: up down restart logs ps deploy deploy-web nginx-reload
up: ## Khởi động api + mongo
	$(COMPOSE) up -d
down: ## Dừng toàn bộ container
	$(COMPOSE) down
restart: ## Khởi động lại api
	$(COMPOSE) up -d --force-recreate api
logs: ## Xem log api
	$(COMPOSE) logs -f api
ps: ## Trạng thái container
	$(COMPOSE) ps
deploy-web: build-fe ## Copy frontend/dist vào WEB_ROOT
	rsync -a --delete $(FRONTEND)/dist/ $(WEB_ROOT)/
nginx-reload: ## Cài nginx conf và reload
	sudo cp nginx/chat.naot.me.conf /etc/nginx/sites-available/chat.naot.me.conf
	sudo ln -sf /etc/nginx/sites-available/chat.naot.me.conf /etc/nginx/sites-enabled/chat.naot.me.conf
	sudo nginx -t && sudo systemctl reload nginx
deploy: image deploy-web restart ## Build + triển khai api và frontend

##@ Dữ liệu
.PHONY: db-shell db-backup
db-shell: ## Mở mongosh
	$(COMPOSE) exec mongo sh -c 'mongosh -u "$$MONGO_INITDB_ROOT_USERNAME" -p "$$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin chatfrog'
db-backup: ## mongodump → BACKUP_DIR/chatfrog-<ngày>.archive.gz
	mkdir -p $(BACKUP_DIR)
	$(COMPOSE) exec -T mongo sh -c 'mongodump -u "$$MONGO_INITDB_ROOT_USERNAME" -p "$$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --db chatfrog --archive --gzip' > $(BACKUP_DIR)/chatfrog-$$(date +%F).archive.gz

##@ Dọn dẹp
.PHONY: clean
clean: ## Xoá build output
	rm -rf $(FRONTEND)/dist $(BACKEND)/bin
