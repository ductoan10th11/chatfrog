/**
 * All user-visible strings (Vietnamese). No i18n library in v1.
 * Technical terms (token, prompt, reasoning, ...) may stay in English.
 */
export const S = {
  app: {
    name: 'ChatFrog',
    loading: 'Đang tải…',
    unknownError: 'Đã có lỗi xảy ra. Vui lòng thử lại.',
    networkError: 'Không thể kết nối tới máy chủ.',
    retry: 'Thử lại',
    cancel: 'Huỷ',
    save: 'Lưu',
    delete: 'Xoá',
    close: 'Đóng',
    copy: 'Sao chép',
    copied: 'Đã sao chép',
    back: 'Quay lại',
  },

  auth: {
    loginTitle: 'Chào mừng đến với ChatFrog',
    loginSubtitle: 'Trợ lý AI tự host: trò chuyện, viết code và tạo ảnh.',
    loginWithGoogle: 'Đăng nhập với Google',
    pendingTitle: 'Tài khoản đang chờ duyệt',
    pendingBody:
      'Quản trị viên sẽ xem xét và kích hoạt tài khoản của bạn. Bạn có thể quay lại sau.',
    blockedTitle: 'Tài khoản đã bị chặn',
    blockedBody: 'Vui lòng liên hệ quản trị viên nếu bạn cho rằng đây là nhầm lẫn.',
    recheck: 'Kiểm tra lại',
    logout: 'Đăng xuất',
  },

  nav: {
    openMenu: 'Mở menu',
    closeMenu: 'Đóng menu',
    sidebar: 'Thanh bên',
    newChat: 'Cuộc trò chuyện mới',
    search: 'Tìm kiếm hội thoại',
    searchPlaceholder: 'Tìm kiếm…',
    clearSearch: 'Xoá tìm kiếm',
    noResults: 'Không tìm thấy hội thoại nào.',
    empty: 'Chưa có hội thoại nào.',
    loadingMore: 'Đang tải thêm…',
    pinned: 'Đã ghim',
    today: 'Hôm nay',
    yesterday: 'Hôm qua',
    last7Days: '7 ngày trước',
    older: 'Cũ hơn',
    untitled: 'Hội thoại mới',
    userMenu: 'Menu người dùng',
    settings: 'Cài đặt',
    admin: 'Quản trị',
    theme: 'Giao diện',
  },

  conversation: {
    actions: 'Tuỳ chọn hội thoại',
    rename: 'Đổi tên',
    renameInput: 'Tên hội thoại',
    pin: 'Ghim',
    unpin: 'Bỏ ghim',
    delete: 'Xoá',
    deleteTitle: 'Xoá hội thoại?',
    deleteBody: 'Hội thoại và các tệp của nó sẽ bị xoá vĩnh viễn. Không thể hoàn tác.',
    deleted: 'Đã xoá hội thoại',
    loadError: 'Không tải được hội thoại.',
    notFound: 'Không tìm thấy hội thoại này.',
    goHome: 'Về trang chính',
    loadOlder: 'Đang tải tin nhắn cũ…',
  },

  theme: {
    light: 'Sáng',
    dark: 'Tối',
    system: 'Theo hệ thống',
    toggle: 'Đổi giao diện',
  },

  welcome: {
    title: 'Hôm nay mình giúp gì được cho bạn?',
    subtitle: 'Hỏi bất cứ điều gì, nhờ viết code, hoặc mô tả một bức ảnh bạn muốn tạo.',
    suggestions: [
      {
        label: 'Giải thích một khái niệm',
        prompt: 'Giải thích ngắn gọn cho mình về điện toán lượng tử.',
      },
      {
        label: 'Viết code mẫu',
        prompt: 'Viết code TypeScript debounce hàm kèm bảng so sánh với throttle.',
      },
      { label: 'Vẽ một bức ảnh', prompt: 'Vẽ ảnh một chú ếch xanh ngồi trên lá sen dưới mưa nhẹ.' },
      { label: 'Chỉnh sửa ảnh', prompt: 'Sửa bức ảnh vừa rồi, đổi nền thành hoàng hôn.' },
    ],
    moreIdeas: [
      { label: 'Xếp hàng chờ', prompt: 'Chờ tới lượt rồi trả lời giúp mình nhé.' },
      { label: 'Thử gặp lỗi', prompt: 'Cho mình xem một lỗi từ máy chủ.' },
    ],
    suggestionsLabel: 'Gợi ý',
  },

  composer: {
    placeholder: 'Nhắn tin cho ChatFrog…',
    label: 'Tin nhắn',
    send: 'Gửi tin nhắn',
    stop: 'Dừng tạo',
    attach: 'Đính kèm tệp (sắp có)',
    hint: 'Enter để gửi, Shift+Enter để xuống dòng',
    disclaimer: 'ChatFrog có thể mắc lỗi. Hãy kiểm tra thông tin quan trọng.',
    tooLong: 'Tin nhắn quá dài.',
    busy: 'Đang tạo câu trả lời…',
  },

  chat: {
    messages: 'Tin nhắn',
    scrollToBottom: 'Cuộn xuống cuối',
    you: 'Bạn',
    assistant: 'ChatFrog',
    thinking: 'Đang suy nghĩ…',
    thoughtFor: (seconds: number) => `Đã suy nghĩ trong ${seconds}s`,
    thoughtBrief: 'Đã suy nghĩ',
    toggleReasoning: 'Hiện hoặc ẩn phần suy nghĩ',
    queued: (position: number) =>
      position > 0 ? `Đang chờ tới lượt… (vị trí ${position})` : 'Đang chờ tới lượt…',
    writing: 'Đang viết…',
    stopped: 'Đã dừng tạo câu trả lời.',
    errorTitle: 'Không tạo được câu trả lời',
    errorGeneric: 'Đã có lỗi khi tạo câu trả lời.',
    streamEnded: 'Kết nối bị gián đoạn trước khi hoàn tất.',
    copy: 'Sao chép',
    copied: 'Đã sao chép',
    regenerate: 'Tạo lại',
    edit: 'Sửa tin nhắn',
    editSave: 'Lưu và gửi lại',
    editCancel: 'Huỷ',
    editLabel: 'Nội dung tin nhắn',
    editHint: 'Các tin nhắn phía sau sẽ bị thay thế.',
    messageActions: 'Thao tác với tin nhắn',
    conflict: 'Hội thoại đang tạo câu trả lời. Vui lòng đợi hoặc dừng trước.',
    sendFailed: 'Không gửi được tin nhắn.',
    emptyConversation: 'Hãy bắt đầu cuộc trò chuyện.',
  },

  code: {
    copy: 'Sao chép mã',
    copied: 'Đã sao chép mã',
    plain: 'văn bản',
  },

  tool: {
    generateImage: 'Tạo ảnh',
    generating: 'Đang tạo ảnh…',
    queued: 'Đang chờ tới lượt tạo ảnh…',
    prompt: 'Prompt đã viết lại',
    referenceImages: (n: number) => `Dùng ${n} ảnh tham chiếu`,
    failed: 'Không tạo được ảnh.',
    imageAlt: 'Ảnh do ChatFrog tạo',
  },

  settings: {
    title: 'Cài đặt',
    comingSoon: 'Trang cài đặt sẽ có ở bước sau.',
  },

  admin: {
    title: 'Quản trị',
    comingSoon: 'Trang quản trị sẽ có ở bước sau.',
  },

  errors: {
    unauthenticated: 'Bạn cần đăng nhập.',
    forbidden: 'Bạn không có quyền thực hiện thao tác này.',
    not_found: 'Không tìm thấy dữ liệu.',
    conflict: 'Xung đột: hội thoại đang tạo câu trả lời.',
    rate_limited: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau.',
    model_unavailable: 'Máy chủ mô hình hiện không khả dụng.',
    image_unavailable: 'Máy chủ tạo ảnh hiện không khả dụng.',
    internal: 'Lỗi máy chủ nội bộ.',
    payload_too_large: 'Tệp hoặc nội dung quá lớn.',
    unsupported_media_type: 'Định dạng tệp không được hỗ trợ.',
    invalid_request: 'Yêu cầu không hợp lệ.',
  } as Record<string, string>,
} as const
