# ChatFrog — API Contract

Phiên bản 0.1 · 2026-10-21 · Xem thêm [SPEC.md](SPEC.md)

Frontend mock (MSW) và backend Go đều phải tuân theo contract này. Mọi thay đổi phải được cập nhật vào đây trước.

## Quy ước

- Base path: `/api`. Body là JSON (`Content-Type: application/json`), riêng upload dùng `multipart/form-data`.
- Xác thực bằng cookie `cf_session` (HttpOnly). Frontend gọi với `credentials: "include"`.
- Mọi request khác GET phải có header `Origin` trùng `APP_ORIGIN`.
- ID là ObjectID của Mongo dạng hex (24 ký tự). Thời gian theo ISO 8601 UTC.
- Trường JSON dùng `snake_case`.
- Phân trang theo cursor: `?limit=<n>&cursor=<opaque>` → `{ "items": [...], "next_cursor": "..." | null }`.

### Lỗi

```json
{ "error": { "code": "not_found", "message": "Không tìm thấy hội thoại" } }
```

| HTTP | `code` |
|---|---|
| 400 | `invalid_request` |
| 401 | `unauthenticated` |
| 403 | `forbidden`, `account_pending`, `account_blocked` |
| 404 | `not_found` |
| 409 | `conflict` (ví dụ hội thoại đang có generation chạy) |
| 413 | `payload_too_large` |
| 415 | `unsupported_media_type` |
| 429 | `rate_limited` (kèm header `Retry-After`) |
| 502 / 503 | `model_unavailable`, `image_unavailable` |
| 500 | `internal` |

## Kiểu dữ liệu

### User
```ts
type User = {
  id: string
  email: string
  name: string
  avatar_url: string | null
  role: "user" | "admin"
  status: "pending" | "active" | "blocked"
  settings: { custom_instructions: string; theme: "light" | "dark" | "system" }
  created_at: string
  last_login_at: string
}
```

### Conversation
```ts
type Conversation = {
  id: string
  title: string            // "" khi chưa đặt tiêu đề
  pinned: boolean
  created_at: string
  updated_at: string
}
```

### FileRef
```ts
type FileRef = {
  id: string
  kind: "upload" | "generated"
  name: string
  mime: string
  size: number             // bytes
  width?: number           // chỉ có với ảnh
  height?: number
  url: string              // "/api/files/<id>"
  truncated?: boolean      // tài liệu: text trích xuất bị cắt theo DOC_MAX_CHARS
}
```

### Message
```ts
type Message = {
  id: string
  conversation_id: string
  role: "user" | "assistant"
  status: "streaming" | "complete" | "stopped" | "error"
  parts: Part[]
  error?: { code: string; message: string }
  created_at: string
}

type Part =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string; duration_ms: number }
  | { type: "attachment"; file: FileRef }              // chỉ có ở tin nhắn user
  | {
      type: "tool_call"
      id: string
      name: "generate_image"
      args: { prompt: string; size?: string; reference_image_ids?: string[] }
      status: "queued" | "running" | "done" | "error"
      result?: { file: FileRef }
      error?: string
    }
```

Thứ tự `parts` của một tin nhắn assistant thường là: `reasoning` → `text` → `tool_call` → (`reasoning` → `text` của vòng tiếp theo).

## Endpoints

### Auth

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/auth/google/login?redirect=/c/abc` | 302 sang Google. `redirect` chỉ nhận đường dẫn tương đối |
| GET | `/api/auth/google/callback` | Google gọi lại → set cookie → 302 về `redirect`, hoặc `/pending` nếu user chưa được duyệt |
| POST | `/api/auth/logout` | Xoá session. `204` |
| GET | `/api/me` | `200 User`; `401` nếu chưa đăng nhập |

User `pending` / `blocked` chỉ gọi được `/api/me` và `/api/auth/logout`; mọi endpoint khác trả `403` với code tương ứng.

### Conversations

| Method | Path | Body / Query | Response |
|---|---|---|---|
| GET | `/api/conversations` | `?limit=30&cursor=&q=` | `{ items: Conversation[], next_cursor }`, sắp xếp theo `pinned` rồi `updated_at` giảm dần |
| POST | `/api/conversations` | `{ title?: string }` | `201 Conversation` |
| GET | `/api/conversations/:id` | — | `Conversation` |
| PATCH | `/api/conversations/:id` | `{ title?: string, pinned?: boolean }` | `Conversation` |
| DELETE | `/api/conversations/:id` | — | `204` |
| GET | `/api/conversations/:id/messages` | `?limit=50&cursor=` (cursor đi về quá khứ) | `{ items: Message[], next_cursor }`, sắp xếp theo `created_at` tăng dần trong từng trang |

Có thể tạo hội thoại mới và gửi tin nhắn đầu tiên trong một bước: gọi `POST /api/conversations/new/messages`. Event `message.created` sẽ trả về `conversation` vừa tạo.

### Generation (SSE)

Ba endpoint dưới đây đều trả `Content-Type: text/event-stream` (xem [SSE events](#sse-events)). Frontend gọi bằng `fetch` + `ReadableStream`, không dùng `EventSource` vì cần gửi POST. Để **stop**, frontend `abort()` request; backend lưu phần đã sinh với `status = stopped`.

| Method | Path | Body | Mô tả |
|---|---|---|---|
| POST | `/api/conversations/:id/messages` | `{ content: string, attachment_ids?: string[] }` | Gửi tin nhắn mới (`:id = new` để tạo hội thoại) |
| POST | `/api/messages/:id/regenerate` | — | `:id` là tin nhắn assistant **cuối cùng**; tin nhắn cũ bị thay thế |
| POST | `/api/messages/:id/edit` | `{ content: string, attachment_ids?: string[] }` | `:id` là tin nhắn user; các tin nhắn sau nó bị xoá, rồi sinh lại câu trả lời |

Mỗi hội thoại chỉ có một generation chạy tại một thời điểm; gọi thêm khi đang chạy → `409 conflict`.

### Files

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/files` | multipart: `file`, `conversation_id?` | `201 FileRef` |
| GET | `/api/files/:id` | — | Nội dung file (chỉ chủ sở hữu). Ảnh trả `inline`, file khác trả `attachment` |
| GET | `/api/files/:id/thumb` | — | Ảnh WebP, cạnh dài 384px (chỉ áp dụng cho ảnh) |
| DELETE | `/api/files/:id` | — | `204`; trả `409` nếu file đã được dùng trong một tin nhắn |

### Settings

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/settings` | — | `User["settings"]` |
| PUT | `/api/settings` | `{ custom_instructions: string, theme: "light" \| "dark" \| "system" }` | `User["settings"]` |

### Admin (role `admin`)

| Method | Path | Body / Query | Response |
|---|---|---|---|
| GET | `/api/admin/users` | `?status=&q=&limit=&cursor=` | `{ items: AdminUser[], next_cursor }` |
| PATCH | `/api/admin/users/:id` | `{ status?: "active" \| "blocked", role?: "user" \| "admin" }` | `AdminUser` |
| GET | `/api/admin/stats` | `?from=2026-10-01&to=2026-10-21` | `Stats` |
| GET | `/api/admin/health` | — | `Health` |

```ts
type AdminUser = User & { message_count: number; image_count: number }

type Stats = {
  days: { date: string; messages: number; images: number; prompt_tokens: number; completion_tokens: number; avg_latency_ms: number }[]
  totals: { users: number; active_users: number; conversations: number; messages: number; images: number; storage_bytes: number }
}

type Health = {
  llm:   { ok: boolean; latency_ms: number | null; model: string; last_error: string | null; checked_at: string }
  image: { ok: boolean; latency_ms: number | null; model: string; last_error: string | null; checked_at: string }
  mongo: { ok: boolean }
}
```

PATCH user sang `blocked` sẽ huỷ toàn bộ session của user đó. Admin không tự chặn hay tự hạ quyền chính mình được (`400`).

### System

| Method | Path | Response |
|---|---|---|
| GET | `/api/healthz` | `200 { "ok": true }` (không cần đăng nhập, dùng cho container healthcheck) |

## SSE events

Định dạng mỗi event:

```
event: text.delta
data: {"index":1,"delta":"Xin chào"}

```

Server gửi comment `: ping` mỗi 15 giây để giữ kết nối. `index` là vị trí của part trong `Message.parts`.

| Event | `data` | Ghi chú |
|---|---|---|
| `message.created` | `{ conversation: Conversation, user_message: Message, assistant_message: Message }` | Luôn là event đầu tiên; `assistant_message.parts = []` |
| `queue` | `{ position: number }` | Đang chờ semaphore của LLM |
| `reasoning.delta` | `{ index, delta }` | Part `reasoning` mới được tạo ngầm khi gặp `index` lần đầu |
| `reasoning.done` | `{ index, duration_ms }` | |
| `text.delta` | `{ index, delta }` | |
| `tool.start` | `{ index, id, name, args }` | Part `tool_call` với `status = queued` |
| `tool.running` | `{ index, id }` | Đã có lượt sử dụng image server |
| `tool.done` | `{ index, id, result: { file: FileRef } }` | |
| `tool.error` | `{ index, id, error }` | LLM vẫn tiếp tục và giải thích lỗi |
| `conversation.title` | `{ conversation_id, title }` | Có thể đến sau `message.done` |
| `message.done` | `{ message: Message }` | Trạng thái cuối cùng của tin nhắn (dùng để đồng bộ lại) |
| `error` | `{ code, message }` | Lỗi nghiêm trọng; stream đóng ngay sau event này |

Ví dụ một lượt có tạo ảnh:

```
event: message.created
data: {"conversation":{...},"user_message":{...},"assistant_message":{"id":"6717...","parts":[],"status":"streaming",...}}

event: reasoning.delta
data: {"index":0,"delta":"Người dùng muốn một bức ảnh con ếch..."}

event: reasoning.done
data: {"index":0,"duration_ms":2310}

event: text.delta
data: {"index":1,"delta":"Mình sẽ tạo một chú ếch xanh ngồi trên lá sen dưới mưa nhẹ."}

event: tool.start
data: {"index":2,"id":"call_1","name":"generate_image","args":{"prompt":"A cute green frog sitting on a lotus leaf in gentle rain, soft morning light, watercolor style","size":"1024x1024"}}

event: tool.running
data: {"index":2,"id":"call_1"}

event: tool.done
data: {"index":2,"id":"call_1","result":{"file":{"id":"6717...","kind":"generated","mime":"image/png","url":"/api/files/6717...","width":1024,"height":1024,...}}}

event: text.delta
data: {"index":3,"delta":"Bạn muốn đổi sang phong cách khác không?"}

event: message.done
data: {"message":{...,"status":"complete"}}
```
