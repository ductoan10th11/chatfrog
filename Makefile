# ChatFrog — xem `make help`

SHELL := /bin/bash
.DEFAULT_GOAL := help

WEB     := apps/web
API     := apps/api
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)

ENV_FILE ?= .env
COMPOSE  := podman compose -f compose.yaml --env-file $(ENV_FILE)

NGINX_CONF := chat.naot.me.conf
BACKUP_DIR ?= ./backups

##@ Chung
.PHONY: help
help: ## Liệt kê các lệnh
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z0-9_-]+:.*?##/ { printf "  \033[32m%-16s\033[0m %s\n", $$1, $$2 } /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) }' $(MAKEFILE_LIST)

.PHONY: install install-web install-api
install: install-web install-api ## Cài dependency web + api
install-web:
	cd $(WEB) && npm ci
install-api:
	cd $(API) && go mod download

##@ Phát triển
.PHONY: dev dev-web dev-mock dev-api db-up db-down
dev: db-up ## Chạy web + api song song
	$(MAKE) -j2 dev-web dev-api
dev-web: ## Chạy web (Vite)
	cd $(WEB) && npm run dev
dev-mock: ## Chạy web với MSW mock API (không cần api)
	cd $(WEB) && VITE_MOCK=1 npm run dev
dev-api: ## Chạy api trên host (đọc .env)
	cd $(API) && set -a && source ../../$(ENV_FILE) && set +a && go run ./cmd/server
db-up: ## Khởi động container db
	$(COMPOSE) up -d db
db-down: ## Dừng container db
	$(COMPOSE) stop db

##@ Chất lượng
.PHONY: fmt lint lint-web lint-api test test-web test-api check
fmt: ## Format code
	cd $(WEB) && npx prettier --write .
	if [ -d $(API) ]; then cd $(API) && gofmt -w . && go mod tidy; fi
lint: lint-web lint-api ## Lint toàn bộ
lint-web:
	cd $(WEB) && npm run lint && npx tsc --noEmit
lint-api:
	if [ -d $(API) ]; then cd $(API) && go vet ./...; fi
test: test-web test-api ## Chạy test toàn bộ
test-web:
	cd $(WEB) && npm test -- --run
test-api:
	if [ -d $(API) ]; then cd $(API) && go test -race ./...; fi
check: lint test ## Lint + test (chạy trước khi commit)

##@ Build
.PHONY: build build-web build-web-mock build-api
build: build-web build-api ## Build web + api
build-web: ## Build web → apps/web/dist (nginx phục vụ trực tiếp)
	cd $(WEB) && npm run build
build-web-mock: ## Build web kèm mock API (xem trước khi chưa có api)
	cd $(WEB) && VITE_MOCK=1 npm run build
build-api: ## Build binary api → apps/api/bin/chatfrog
	cd $(API) && CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=$(VERSION)" -o bin/chatfrog ./cmd/server

##@ Container (chatfrog-api :9260, chatfrog-db :9261)
.PHONY: up down restart logs ps
up: ## Build + khởi động api và db
	$(COMPOSE) up -d --build
down: ## Dừng và xoá container (giữ volume)
	$(COMPOSE) down
restart: ## Build lại và khởi động lại api
	$(COMPOSE) up -d --build --force-recreate api
logs: ## Xem log api
	$(COMPOSE) logs -f api
ps: ## Trạng thái container
	$(COMPOSE) ps

##@ Triển khai
.PHONY: deploy nginx-link nginx-reload
deploy: build-web restart ## Build web + build lại api
nginx-link: ## Symlink nginx conf vào sites-enabled + reload
	sudo ln -sf $(CURDIR)/nginx/$(NGINX_CONF) /etc/nginx/sites-enabled/$(NGINX_CONF)
	$(MAKE) nginx-reload
nginx-reload: ## Kiểm tra cấu hình và reload nginx
	sudo nginx -t && sudo systemctl reload nginx

##@ Dữ liệu
.PHONY: db-shell db-backup
db-shell: ## Mở mongosh
	$(COMPOSE) exec db sh -c 'mongosh -u "$$MONGO_INITDB_ROOT_USERNAME" -p "$$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin chatfrog'
db-backup: ## mongodump → BACKUP_DIR/chatfrog-<ngày>.archive.gz
	mkdir -p $(BACKUP_DIR)
	$(COMPOSE) exec -T db sh -c 'mongodump -u "$$MONGO_INITDB_ROOT_USERNAME" -p "$$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --db chatfrog --archive --gzip' > $(BACKUP_DIR)/chatfrog-$$(date +%F).archive.gz

##@ Dọn dẹp
.PHONY: clean
clean: ## Xoá build output
	rm -rf $(WEB)/dist $(API)/bin
