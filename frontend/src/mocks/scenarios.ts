import { fold } from './utils'

export type ScenarioKind = 'default' | 'code' | 'image' | 'edit-image' | 'error'

export type Scenario = {
  kind: ScenarioKind
  /** Emit `queue` events before the model starts. */
  queue: boolean
}

/**
 * Pick the mock scenario from the user's message.
 *   "lỗi"        -> error event
 *   "sửa"        -> image edit (reference_image_ids)
 *   "ảnh" / "vẽ" -> image generation
 *   "code"       -> code block + table
 *   "chờ"        -> queue events first (combines with the others)
 */
export function pickScenario(text: string): Scenario {
  const t = text.normalize('NFC').toLowerCase()
  const has = (w: string) => t.includes(w)
  const queue = has('chờ') || has('cho toi luot')
  if (has('lỗi')) return { kind: 'error', queue }
  if (has('sửa')) return { kind: 'edit-image', queue }
  if (has('ảnh') || has('vẽ')) return { kind: 'image', queue }
  if (fold(t).includes('code')) return { kind: 'code', queue }
  return { kind: 'default', queue }
}

export function snippet(text: string, max = 48): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

/** Conversation title fallback: first 60 chars of the first message (SPEC 4.1). */
export function deriveTitle(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim()
  if (!one) return 'Hội thoại mới'
  const cut = one.length > 60 ? `${one.slice(0, 59)}…` : one
  return cut.charAt(0).toUpperCase() + cut.slice(1)
}

export function reasoningFor(kind: ScenarioKind, userText: string): string {
  const q = snippet(userText, 60)
  switch (kind) {
    case 'code':
      return `Người dùng muốn một ví dụ code: "${q}". Mình nên đưa ra đoạn code ngắn gọn, có chú thích, rồi bổ sung bảng so sánh để dễ nắm ý. Cần chú ý định dạng markdown và ngôn ngữ của code block.`
    case 'image':
      return `Người dùng muốn có một bức ảnh: "${q}". Mình sẽ viết 1–2 câu tiếng Việt giải thích sẽ tạo gì, sau đó gọi tool generate_image với prompt tiếng Anh chi tiết về chủ thể, bố cục, ánh sáng và phong cách.`
    case 'edit-image':
      return `Người dùng muốn chỉnh sửa ảnh đã có: "${q}". Mình cần tìm id của ảnh gần nhất trong hội thoại và truyền vào reference_image_ids để backend gọi images.edit thay vì generate.`
    case 'error':
      return `Người dùng nhắc tới lỗi: "${q}". Mình sẽ thử trả lời, nhưng đây là kịch bản mô phỏng máy chủ mô hình gặp sự cố giữa chừng.`
    default:
      return `Người dùng hỏi: "${q}". Mình sẽ trả lời ngắn gọn bằng tiếng Việt, chia ý rõ ràng với danh sách đánh số, và kết thúc bằng một câu hỏi gợi mở để tiếp tục hội thoại. Không cần dùng tool.`
  }
}

const DEFAULT_ANSWERS = [
  (q: string) => `Về câu hỏi “${q}”, đây là **tóm tắt ngắn gọn**:

1. Xác định rõ mục tiêu bạn muốn đạt được.
2. Chia nhỏ công việc thành các bước dễ quản lý.
3. Kiểm tra lại kết quả và điều chỉnh khi cần.

> Mẹo: bắt đầu từ việc nhỏ nhất, rồi mở rộng dần.

Một vài điểm cần lưu ý:

- Dùng \`inline code\` cho tên hàm hoặc lệnh, ví dụ \`make dev-mock\`.
- Tham khảo thêm tại [tài liệu của MDN](https://developer.mozilla.org) nếu cần.
- Danh sách việc cần làm:
  - [x] Đọc yêu cầu
  - [ ] Viết bản nháp

Bạn có muốn mình đi sâu vào phần nào không?`,
  (q: string) => `Cảm ơn bạn đã hỏi về “${q}”. Mình trả lời theo hai hướng:

### Hướng thứ nhất
Tiếp cận từ **lý thuyết**: nắm khái niệm cốt lõi trước, rồi mới áp dụng vào ví dụ.

### Hướng thứ hai
Tiếp cận từ **thực hành**: làm thử một ví dụ nhỏ, sau đó quay lại đọc lý thuyết để hiểu vì sao nó chạy.

Nếu bạn cho mình biết thêm bối cảnh, mình sẽ gợi ý cụ thể hơn. *Bạn đang dùng cho mục đích gì?*`,
]

export function defaultAnswer(userText: string, variant: number): string {
  return DEFAULT_ANSWERS[variant % DEFAULT_ANSWERS.length](snippet(userText, 60))
}

export function codeAnswer(): string {
  return `Dưới đây là một hàm \`debounce\` viết bằng TypeScript, kèm so sánh với \`throttle\`.

\`\`\`ts
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  wait = 300,
): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
}

// Ví dụ: chỉ gọi API sau khi người dùng ngừng gõ 400ms
const onInput = debounce((q: string) => console.log('search', q), 400)
\`\`\`

Cùng ý tưởng đó trong Python:

\`\`\`python
import threading

def debounce(wait):
    def decorator(fn):
        timer = None
        def wrapper(*args, **kwargs):
            nonlocal timer
            if timer:
                timer.cancel()
            timer = threading.Timer(wait, fn, args, kwargs)
            timer.start()
        return wrapper
    return decorator
\`\`\`

### So sánh debounce và throttle

| Tiêu chí | debounce | throttle |
| --- | --- | --- |
| Khi nào gọi hàm | Sau khi ngừng sự kiện một khoảng \`wait\` | Tối đa một lần mỗi \`wait\` |
| Phù hợp | Ô tìm kiếm, validate form | Scroll, resize, kéo thả |
| Số lần gọi | Ít hơn | Đều đặn hơn |

Chạy thử bằng lệnh \`npm test\` để kiểm tra.`
}

export function imageIntro(kind: 'image' | 'edit-image', userText: string): string {
  return kind === 'edit-image'
    ? 'Mình sẽ chỉnh sửa bức ảnh gần nhất theo yêu cầu của bạn.'
    : `Mình sẽ tạo bức ảnh theo mô tả “${snippet(userText, 60)}”.`
}

export function imagePrompt(userText: string, edit: boolean): string {
  const t = userText.toLowerCase()
  if (edit) {
    return 'Edit the reference image: replace the background with a warm sunset sky, keep the main subject unchanged, soft golden light, consistent style'
  }
  if (t.includes('ếch') || t.includes('ech')) {
    return 'A cute green frog sitting on a lotus leaf in gentle rain, soft morning light, watercolor style'
  }
  return `A detailed, high quality illustration of: ${snippet(userText, 80)}, balanced composition, soft natural lighting, painterly style`
}

export const imageOutro = 'Bạn muốn đổi sang phong cách khác hoặc chỉnh lại chi tiết nào không?'

export const ERROR_PARTIAL = 'Để mình thử xử lý yêu cầu này. Đầu tiên, mình sẽ'
export const ERROR_MESSAGE = {
  code: 'model_unavailable',
  message: 'Máy chủ mô hình không phản hồi (mô phỏng).',
}
