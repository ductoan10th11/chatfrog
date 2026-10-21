# ChatFrog — Spec

Phiên bản 0.1 · 2026-10-21 · Nguồn: [IDEA.md](IDEA.md) · API: [API.md](API.md)

## 1. Tóm tắt

ChatFrog là nền tảng chatbot AI tự host cho một nhóm nhỏ người dùng. Người dùng chat với LLM (Qwen3.5-4B, luôn bật thinking); LLM tự quyết định gọi tool `generate_image` để tạo hoặc chỉnh sửa ảnh (FLUX.2 klein 4B) khi cần, đồng thời giải thích ngắn gọn. Hỗ trợ đính kèm ảnh và tài liệu. Đăng nhập bằng Google, admin duyệt người dùng.

## 2. Phạm vi

**Trong phạm vi (v1)**
- Chat streaming, hiển thị reasoning (thinking) dạng thu gọn
- Tool `generate_image`: text-to-image và image-to-image (ảnh tham chiếu)
- Đính kèm ảnh (cho vision và làm ảnh tham chiếu) và tài liệu (PDF, DOCX, TXT, MD, CSV, code)
- Quản lý hội thoại: tạo, đổi tên, ghim, xoá, tìm kiếm
- Sửa tin nhắn user, regenerate, stop
- Google OAuth, duyệt user, trang admin (user, thống kê, health)
- Cài đặt cá nhân: custom instructions, theme light/dark
- Responsive + PWA (cài lên màn hình chính)
- Giao diện tiếng Việt, thuật ngữ chuyên môn giữ tiếng Anh

**Ngoài phạm vi (v1)**
- Chia sẻ hội thoại qua link công khai, export hội thoại
- Quota / giới hạn sử dụng theo user (chỉ có rate limit chống lạm dụng)
- Rẽ nhánh hội thoại (branching): sửa hoặc regenerate sẽ **thay thế** các tin nhắn phía sau
- RAG bằng vector search (xem §13. Câu hỏi mở)
- CI (chỉ có Makefile)

## 3. Người dùng và phân quyền

| Role | Quyền |
|---|---|
| `user` | Chat, tạo ảnh, quản lý hội thoại và file của chính mình |
| `admin` | Như `user` + quản lý user, xem thống kê, xem health model |

Trạng thái user: `pending` → `active` | `blocked`.
- Đăng nhập Google lần đầu → tạo user `pending`, chuyển sang trang "Chờ duyệt".
- Email nằm trong `ADMIN_EMAILS` → tự động `active` + `admin` (bootstrap).
- Email nằm trong `ALLOWED_EMAILS` → tự động `active` + `user`.
- Admin duyệt / chặn / đổi role trong trang admin. User `blocked` bị huỷ toàn bộ session.

## 4. Tính năng

### 4.1. Chat
- Gửi tin nhắn (Enter gửi, Shift+Enter xuống dòng), đính kèm nhiều file.
- Trả lời stream theo token qua SSE. Reasoning hiển thị trong khối "Đang suy nghĩ…" thu gọn được, kèm thời gian suy nghĩ.
- Markdown (GFM: bảng, list, task list), code block có syntax highlight và nút copy. **Không** render raw HTML.
- Stop: huỷ request → backend huỷ lời gọi model, lưu phần đã sinh với `status = stopped`.
- Regenerate tin nhắn assistant cuối; sửa một tin nhắn user → xoá các tin nhắn sau nó và sinh lại.
- Tự đặt tiêu đề hội thoại sau lượt trả lời đầu tiên (gọi LLM riêng, tắt thinking qua `chat_template_kwargs`; nếu thất bại thì lấy 60 ký tự đầu của tin nhắn).

### 4.2. Tool `generate_image`
LLM nhận tool definition sau (OpenAI function calling):

```json
{
  "type": "function",
  "function": {
    "name": "generate_image",
    "description": "Tạo ảnh mới hoặc chỉnh sửa ảnh có sẵn. Chỉ gọi khi người dùng muốn có ảnh. Viết prompt bằng tiếng Anh, chi tiết về chủ thể, bố cục, ánh sáng, phong cách.",
    "parameters": {
      "type": "object",
      "properties": {
        "prompt": { "type": "string", "description": "Prompt tiếng Anh đã được viết lại, chi tiết" },
        "size": { "type": "string", "enum": ["1024x1024", "1536x1024", "1024x1536", "2048x2048", "2048x1152", "1152x2048"], "default": "1024x1024" },
        "reference_image_ids": { "type": "array", "items": { "type": "string" }, "description": "ID các ảnh trong hội thoại cần chỉnh sửa / tham chiếu" }
      },
      "required": ["prompt"]
    }
  }
}
```

Hành vi mong muốn (ghi trong system prompt):
- LLM viết 1 câu tiếng Việt ngắn cho biết sẽ tạo gì, rồi gọi tool; sau khi có kết quả chỉ trả lời đúng 1 câu ngắn dạng "Tôi đã tạo cho bạn bức ảnh về …".
- Prompt gửi model ảnh được LLM **viết lại** bằng tiếng Anh. UI hiển thị prompt đã viết lại (thu gọn) dưới ảnh.
- Mỗi ảnh (upload hoặc đã tạo) được gắn nhãn `[image id=<id>]` trong context gửi LLM, để LLM tham chiếu khi chỉnh sửa ("đổi nền bức ảnh vừa rồi thành màu xanh").
- Có `reference_image_ids` → backend gọi `images.edit`; không có → `images.generate`. Image server hỗ trợ cả hai, kích thước tối đa 2048px (2K).
- Mặc định `1024x1024`; LLM chỉ chọn 2K khi người dùng yêu cầu ảnh lớn hoặc nét.

### 4.3. Đính kèm
- **Ảnh** (PNG, JPEG, WebP; ≤ 10 MB): LLM server có vision, nên ảnh được gửi cho LLM dạng `image_url` (data URI). Trước khi gửi, ảnh được thu nhỏ để cạnh dài ≤ `VISION_MAX_PX` (1024), giúp tiết kiệm context 32k. Ảnh gốc vẫn được dùng làm ảnh tham chiếu cho tool. Chỉ gửi ảnh của **tin nhắn mới nhất**; ảnh ở các lượt cũ chỉ còn nhãn `[image id=...]`.
- **Tài liệu** (PDF, DOCX, TXT, MD, CSV, file code; ≤ 20 MB): backend trích xuất text khi upload và lưu lại. Khi gửi, text được **chèn thẳng** vào tin nhắn user dạng `<document name="...">…</document>`, cắt theo `DOC_MAX_CHARS` (khoảng 8k token). Nếu bị cắt thì UI cảnh báo. Không làm RAG ở v1.
- Kiểm tra loại file bằng magic bytes, không tin `Content-Type` từ client.

### 4.4. Hội thoại
- Sidebar: hội thoại đã ghim ở trên, còn lại nhóm theo thời gian (Hôm nay, Hôm qua, 7 ngày trước, Cũ hơn).
- Tìm kiếm theo tiêu đề và nội dung (Mongo text index).
- Xoá hội thoại → xoá messages và các file chỉ thuộc hội thoại đó.

### 4.5. Admin
- Danh sách user: email, tên, avatar, role, status, lần đăng nhập cuối, số tin nhắn / ảnh. Thao tác: duyệt, chặn, đổi role.
- Thống kê theo ngày: số tin nhắn, số ảnh, token in/out (nếu server trả `usage`), thời gian phản hồi trung bình.
- Health: trạng thái LLM server và image server (latency, lỗi gần nhất), dung lượng storage.
- Ghi audit log cho mọi thao tác admin.

### 4.6. Cài đặt cá nhân
- Custom instructions (≤ 2000 ký tự), được nối vào sau system prompt mặc định.
- Theme: light / dark / theo hệ thống.

## 5. Kiến trúc

```
Browser (React SPA, PWA)
   │ HTTPS
   ▼
Cloudflare (TLS, proxy)
   │ HTTP
   ▼
nginx (host :80, chat.naot.me) ── limit_req, phục vụ apps/web/dist
   │ /api/*  → 127.0.0.1:9260  (proxy_buffering off cho SSE)
   ▼
chatfrog-api (Go/Chi, container) ──► MongoDB Atlas (MONGO_URI, TLS)
   │                             └► /data/files (volume: upload + ảnh đã tạo)
   │  Tailscale (LAN)
   ├──► LLM server   (OpenAI-compatible /v1/chat/completions, stream, tools)
   └──► Image server (OpenAI-compatible /v1/images/generations|edits, b64_json)
```

- Trình duyệt không bao giờ gọi trực tiếp model server.
- Package `provider` là client OpenAI-compatible tự viết (net/http) với `base_url` cấu hình được, thay cho `openai-go`: gateway (Ollama) trả reasoning ở field không chuẩn (`reasoning`), llama.cpp / vLLM dùng `reasoning_content`, có server lại trả `<think>…</think>` trong `content`; parser xử lý cả ba. Thinking bật bằng `reasoning_effort` (`LLM_REASONING_EFFORT`), tắt bằng `"none"` + `chat_template_kwargs.enable_thinking=false`. Có 2 interface `LLMProvider` và `ImageProvider` để dễ thay thế và mock trong test.
- Nếu một lượt LLM kết thúc ngay sau phần thinking mà không có nội dung hay tool call (gặp với model nhỏ khi có tools), backend gọi lại lượt đó với thinking tắt.
- Giới hạn đồng thời bằng semaphore: `LLM_MAX_CONCURRENCY`, `IMAGE_MAX_CONCURRENCY` (mặc định 1). Request vượt giới hạn sẽ chờ trong hàng đợi; UI hiển thị "Đang chờ tới lượt…" (SSE event `queue`).

### Cấu trúc repo

```
.
├── Makefile
├── compose.yaml              # 1 container: api (:9260); db là MongoDB Atlas
├── .env.example
├── apps/
│   ├── web/                  # Vite + React + TS → dist/ (nginx phục vụ trực tiếp)
│   └── api/                  # Go/Chi
│       ├── Containerfile
│       ├── cmd/server/main.go
│       └── internal/
│       ├── config/           # đọc env
│       ├── httpapi/          # router Chi, middleware, handlers
│       ├── auth/             # Google OIDC, session
│       ├── chat/             # agent loop, build context, title
│       ├── tools/            # generate_image
│       ├── provider/         # LLM / Image client (openai-go)
│       ├── files/            # upload, sniffing, text extraction, storage
│       ├── store/            # repository Mongo
│           └── admin/
├── nginx/chat.naot.me.conf   # symlink vào /etc/nginx/sites-enabled
└── docs/
```

## 6. Luồng xử lý chat (agent loop)

1. Lưu tin nhắn user; tạo tin nhắn assistant `status = streaming`; gửi event `message.created`.
2. Dựng context:
   - System prompt mặc định (vai trò, tiếng Việt, hướng dẫn dùng tool) + custom instructions của user.
   - Lịch sử hội thoại: **bỏ phần reasoning của các lượt trước** (theo khuyến nghị của Qwen). Tool call/result cũ được rút gọn thành `[image id=...]`.
   - Cắt bớt các tin nhắn cũ nhất cho tới khi ước lượng token ≤ `LLM_CONTEXT_TOKENS - LLM_MAX_OUTPUT_TOKENS`.
3. Gọi `chat.completions` với `stream=true`, `tools=[generate_image]`.
   - Reasoning lấy từ `delta.reasoning_content` (llama.cpp / vLLM). Nếu server trả `<think>…</think>` trong `content`, parser sẽ tách ra.
   - Mỗi delta → SSE `reasoning.delta` / `text.delta`.
4. Nếu `finish_reason = tool_calls`:
   - SSE `tool.start` (kèm prompt đã viết lại) → chờ semaphore → gọi image API (timeout `IMAGE_TIMEOUT`) → lưu PNG vào storage → SSE `tool.done` (kèm file).
   - Thêm assistant message (tool_calls) và tool message (`"Đã tạo ảnh id=<id> và hiển thị cho người dùng."`) vào context, rồi quay lại bước 3.
   - Chỉ một vòng tool: sau khi tool chạy xong, LLM được gọi lại **không có tools, tắt thinking, tối đa 160 token** để trả lời đúng 1 câu ngắn ("Tôi đã tạo cho bạn bức ảnh về …"). Lỗi tool được trả lại cho LLM dưới dạng tool result để LLM báo cho người dùng bằng 1 câu.
5. Kết thúc: lưu message (`complete` | `stopped` | `error`), lưu usage, gửi `message.done`. Lượt đầu tiên → sinh tiêu đề → `conversation.title`.
6. Client ngắt kết nối → `ctx` bị huỷ → dừng gọi model, lưu `stopped`.

## 7. Data model (MongoDB)

| Collection | Trường chính | Index |
|---|---|---|
| `users` | `_id, google_sub, email, name, avatar_url, role, status, settings{custom_instructions, theme}, created_at, last_login_at` | unique `google_sub`, unique `email` |
| `sessions` | `_id, token_hash, user_id, user_agent, ip, created_at, expires_at` | unique `token_hash`, TTL `expires_at` |
| `conversations` | `_id, user_id, title, pinned, created_at, updated_at` | `{user_id, pinned, updated_at}`, text `title` |
| `messages` | `_id, conversation_id, user_id, role, status, parts[], usage{prompt_tokens, completion_tokens}, model, error, created_at` | `{conversation_id, created_at}`, text `parts.text` |
| `files` | `_id, user_id, conversation_id, kind(upload\|generated), mime, size, width, height, name, storage_key, extracted_text, created_at` | `{user_id, created_at}` |
| `audit_logs` | `_id, actor_id, action, target_id, meta, created_at` | `{created_at}` |

`parts` của message là danh sách có thứ tự (chi tiết ở [API.md](API.md#message)): `text`, `reasoning`, `attachment`, `tool_call`.

File lưu ở `FILES_DIR/<yyyy>/<mm>/<file_id>` (tên file không dùng input của user).

## 8. Bảo mật

- **OAuth**: Authorization Code + PKCE, kiểm tra `state` và `nonce`, xác minh ID token bằng `coreos/go-oidc`, bắt buộc `email_verified = true`.
- **Session**: token ngẫu nhiên 32 byte; DB chỉ lưu SHA-256 của token. Cookie `cf_session` có `HttpOnly; Secure; SameSite=Lax; Path=/`, TTL 30 ngày, gia hạn trượt (sliding).
- **CSRF**: SameSite=Lax + kiểm tra header `Origin` trùng `APP_ORIGIN` với mọi request khác GET.
- **Rate limit**: nginx `limit_req` cho `/api/auth/*`; trong Go dùng token bucket theo user cho các endpoint gửi tin nhắn và upload.
- **Upload**: giới hạn kích thước ở cả nginx và Go; sniff magic bytes; trả file kèm `X-Content-Type-Options: nosniff`, file không phải ảnh trả với `Content-Disposition: attachment`; luôn kiểm tra quyền sở hữu.
- **Frontend**: không render raw HTML trong markdown; link ngoài mở với `rel="noopener noreferrer"`; CSP chặt (`default-src 'self'; img-src 'self' data: blob: https://lh3.googleusercontent.com`). Script chống nháy theme nằm inline trong `index.html` → `script-src` phải có `'sha256-…'` của script đó; `border-beam` chèn thẻ `<style>` lúc chạy → `style-src 'self' 'unsafe-inline'`.
- **Header**: HSTS, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`.
- **Hạ tầng**: MongoDB Atlas dùng TLS + user riêng, Network Access chỉ cho phép IP của VPS; model server chỉ truy cập được qua Tailscale; `.env` có quyền 600, không commit.
- Validate input tại handler: độ dài tin nhắn ≤ `MAX_MESSAGE_CHARS`, số file đính kèm ≤ 5.

## 9. Cấu hình (env)

| Biến | Ví dụ / mặc định |
|---|---|
| `APP_ORIGIN` | mặc định: origin của `GG_CALLBACK_URL` (`https://chat.naot.me`) |
| `API_PORT` / `HTTP_ADDR` | `9260` / `:9260` (`HTTP_ADDR` ưu tiên hơn) |
| `MONGO_URI` / `MONGO_DB` | `mongodb+srv://…@<cluster>.mongodb.net/chatfrog` (Atlas) / mặc định lấy từ path của URI, nếu không có thì `chatfrog` |
| `GG_CLIENT_ID` / `GG_CLIENT_SECRET` / `GG_CALLBACK_URL` | — / — / `https://chat.naot.me/auth/gg/callback` (cũng nhận tên `GOOGLE_*`) |
| `ADMIN_EMAILS` / `ALLOWED_EMAILS` | danh sách email cách nhau bằng dấu phẩy |
| `SESSION_TTL` | `720h` |
| `BASE_URL` / `API_KEY` | URL và key chung cho LLM + image server |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | mặc định `BASE_URL` / `API_KEY` / bắt buộc |
| `LLM_REASONING_EFFORT` | `low` (`none` = tắt thinking) |
| `LLM_CONTEXT_TOKENS` / `LLM_MAX_OUTPUT_TOKENS` | `32768` / `4096` |
| `LLM_VISION` / `VISION_MAX_PX` | `true` / `1024` |
| `LLM_MAX_CONCURRENCY` | `2` |
| `IMAGE_BASE_URL` / `IMAGE_API_KEY` / `IMAGE_MODEL` | mặc định `BASE_URL` / `API_KEY` / bắt buộc |
| `IMAGE_MAX_CONCURRENCY` / `IMAGE_TIMEOUT` | `1` / `180s` |
| `FILES_DIR` | `/data/files` |
| `MAX_UPLOAD_MB` / `DOC_MAX_CHARS` / `MAX_MESSAGE_CHARS` | `20` / `24000` / `16000` |
| `STATS_TZ` | `Asia/Ho_Chi_Minh` (múi giờ chia ngày cho thống kê) |
| `COOKIE_SECURE` | mặc định `true` khi `APP_ORIGIN` là https |

## 10. Frontend

### Stack
Vite · React 19 · TypeScript (strict) · Tailwind CSS v4 · shadcn/ui · `motion` (Framer Motion) · lucide-react · TanStack Query (dữ liệu server) · Zustand (state UI) · React Router v7 · react-markdown + remark-gfm + Shiki (lazy load) · use-stick-to-bottom · sonner (toast) · MSW (mock API ở giai đoạn 1) · vite-plugin-pwa · Vitest + Testing Library.

Các component chat cơ bản (message, composer, markdown, code block) tự viết trên shadcn. Hiệu ứng lấy từ libraries.dev (bảng dưới).

### Hiệu ứng từ [libraries.dev](https://libraries.dev)
Quy tắc: hiệu ứng nào có nhiều màu thì **đổi hết sang tông xanh lá**; hiệu ứng đơn sắc thì giữ nguyên trắng/đen-xám, vì vẫn nằm trong bảng màu.

| Gói | Dùng ở đâu | Đổi màu |
|---|---|---|
| `thinking-orbs` | Trong `ReasoningBlock` và dòng trạng thái của tin nhắn assistant. Đổi `state` theo pha: `solving` khi đang suy nghĩ, `composing` khi đang viết, `shaping` khi đang tạo ảnh, `breathing` khi đang chờ hàng đợi. Orb lớn ở màn hình chào. | Gói chỉ có đơn sắc → giữ nguyên, `theme` lấy theo class `.dark` |
| `border-beam` | Viền `Composer` khi đang generate; card ảnh khi đang ở hàng đợi | Chỉ có preset (`colorful`/`ocean`/…). Dùng `ocean` + `filter: hue-rotate()` để ra xanh lá; nếu màu không đẹp thì fork phần `styles.ts` (MIT) với palette xanh |
| `img-fx` | `ImageResult`: hiệu ứng pixel churn khi tạo ảnh, xong thì "reveal" thành ảnh thật | Prop `colors` gồm 7 sắc độ xanh lá, `tintFromImage={false}`. Cần `three` → lazy load chỉ khi có ảnh |
| `liquid-gooey` | Nút Gửi ↔ Dừng morph qua lại; các chip đính kèm khi thêm/xoá | Theo màu của nội dung (primary) |
| `metal-fx` | **Không dùng** | Preset chỉ có chromatic/silver/gold, không có xanh lá; lại tốn WebGL cho từng nút |

Mọi hiệu ứng đều tắt hoặc giảm khi người dùng bật `prefers-reduced-motion`.

### Routes
| Route | Màn hình |
|---|---|
| `/login` | Nút "Đăng nhập với Google" |
| `/pending` | Tài khoản đang chờ duyệt |
| `/` | Hội thoại mới (màn hình chào + gợi ý prompt) |
| `/c/:id` | Hội thoại |
| `/settings` | Cài đặt cá nhân |
| `/admin` | Tab: Người dùng · Thống kê · Hệ thống |

### Thành phần chính
`AppShell` (sidebar + main; sidebar thành drawer trên mobile) · `ConversationList` · `MessageList` (tự cuộn xuống, nút "xuống cuối") · `MessageBubble` · `ReasoningBlock` · `MarkdownRenderer` · `CodeBlock` · `ImageResult` (skeleton khi đang tạo, lightbox, tải về, xem prompt) · `AttachmentChip` · `Composer` (textarea tự giãn, kéo-thả / dán file, nút gửi/dừng) · `ThemeToggle`.

### Màu sắc (design tokens)
Chỉ dùng 3 nhóm màu: trắng (light), đen-xám (dark), xanh lá nhạt, dịu (primary). Các giá trị dưới đây là đề xuất ban đầu, sẽ tinh chỉnh khi làm UI.

| Token | Light | Dark |
|---|---|---|
| `--background` | `#FFFFFF` | `#0F1110` |
| `--surface` (sidebar, bubble user) | `#F5F7F5` | `#181B19` |
| `--border` | `#E3E7E4` | `#2A2E2B` |
| `--foreground` | `#131614` | `#E9ECEA` |
| `--muted-foreground` | `#6B736E` | `#9AA29D` |
| `--primary` | `#7CC69A` | `#86CFA3` |
| `--primary-foreground` | `#0E1F15` | `#0E1F15` |
| `--primary-soft` (nền nhấn, focus ring) | `#E7F5EC` | `#1B2A21` |

Màu primary nhạt nên chữ trên nền primary dùng màu tối (`--primary-foreground`) để đảm bảo độ tương phản (WCAG AA).

### Chuỗi giao diện
Tiếng Việt, gom vào một file `src/lib/strings.ts`. Không dùng thư viện i18n ở v1.

## 11. Hạ tầng và triển khai

- **VPS** chính là máy chứa repo này: build và deploy tại chỗ, không cần ssh/rsync. Model chạy ở máy khác trong tailnet.
- **Chỉ 1 container** (podman, `compose.yaml` ở gốc repo, chạy bằng `podman compose`):

  | Container | Cổng (chỉ bind 127.0.0.1) | Volume |
  |---|---|---|
  | `chatfrog-api` | `9260` | `chatfrog-files` → `/data/files` |

- **DB**: MongoDB Atlas qua `MONGO_URI`. Network Access của Atlas phải cho phép IP của VPS. `make db-shell` / `make db-backup` chạy `mongosh` / `mongodump` trong container `mongo:8.0` dùng chính `MONGO_URI`.

- **Web** không chạy container: `make build-web` ra `apps/web/dist`, nginx trên host phục vụ trực tiếp từ thư mục đó.
- **nginx** (`nginx/chat.naot.me.conf`, symlink vào `/etc/nginx/sites-enabled/`): nghe cổng 80, TLS do Cloudflare proxy lo, lấy IP thật từ `CF-Connecting-IP`; `/api/` và `/auth/gg/callback` (OAuth callback) → `127.0.0.1:9260`, không buffer (SSE), timeout 600s; `/api/files` cho body 25 MB; `/api/auth/` có `limit_req`; `/assets/` cache 1 năm; `index.html` và service worker `no-cache`; SPA fallback.
- **Tailscale**: container gọi model server qua MagicDNS/IP tailnet. Mạng rootless của podman (pasta) đi ra ngoài qua host nên truy cập được tailnet; cần kiểm tra lại khi triển khai.
- **Xem trước khi chưa có api**: `make build-web-mock` build kèm mock API (MSW) để nginx phục vụ bản demo. Khi có api, chạy lại `make build-web` để thay.
- **Backup**: `make db-backup` → `mongodump` (từ Atlas) nén theo ngày.
- **Git**: remote GitHub.

## 12. Lộ trình

**Giai đoạn 0, Tài liệu** ✅ SPEC.md, API.md, Makefile, compose.yaml, nginx

**Giai đoạn 1, Frontend (chạy với MSW mock)**
1. Scaffold Vite + Tailwind + shadcn, design tokens, theme light/dark
2. AppShell + sidebar hội thoại (responsive)
3. Composer + MessageList + Markdown/Code + ReasoningBlock, mock SSE stream
4. ImageResult + luồng tool call, đính kèm file
5. Login/pending, settings, admin
6. PWA, kiểm tra trên mobile, hoàn thiện animation

**Giai đoạn 2, Backend**
1. ✅ Scaffold Go/Chi, config, logging (slog), Mongo (Atlas), compose
2. ✅ Google OAuth + session + middleware phân quyền
3. ✅ CRUD conversation/message, files (upload, sniff, extract)
4. ✅ Provider LLM + agent loop + SSE; provider image + tool
5. ✅ Admin, thống kê, health
6. Bỏ mock ở frontend, test end-to-end với model thật qua Tailscale (backend: `make test-api-e2e`)

**Giai đoạn 3, Hoàn thiện**
Rate limit, CSP/headers, nginx, backup, tối ưu (virtualize danh sách tin nhắn dài, cache thumbnail), sửa lỗi.

## 13. Câu hỏi mở

Đã chốt (2026-10-21): thư viện hiệu ứng là libraries.dev · image server hỗ trợ edit, tối đa 2K · LLM có vision, context 32k · tài liệu chèn thẳng vào context · deploy ngay trên máy này · remote GitHub.

Còn mở:
1. Thời gian tạo một ảnh, để đặt `IMAGE_TIMEOUT` và thiết kế UX chờ (sẽ đo khi nối model ở giai đoạn 2).
2. Tên repo GitHub và chế độ public/private.
