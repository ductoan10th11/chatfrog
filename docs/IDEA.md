# Nền tảng Chatbot AI ChatFrog

Mục tiêu xây dựng một nền tảng chatbot AI tự host, đa năng, an toàn và có khả năng tuỳ chỉnh cao.

## 1. Bối cảnh

Mini Project về AI : Chatfrog, Tự xây dựng với các yêu cầu:
- Tự host, toàn quyền kiểm soát dữ liệu
- An toàn, bảo mật cao
- Tuỳ chỉnh linh hoạt

## 2. Các yêu cầu chính

### 2.1. Self-hosted
- Chạy trên hạ tầng của tôi (máy chủ, VPS)
- Toàn quyền kiểm soát dữ liệu và mô hình
- Không phụ thuộc vào nhà cung cấp bên thứ 3

### 2.2. Đa năng
- Chat thông thường
- Image generation

# TeckStack
## Backend:
- Go/Chi
## Frontend: 
- React/TypeScript
- Shadcn
- Libraries.dev
- Framer-motion
- Lucide icon
## Database:
- MongoDB
## Models:
- LLM: Qwen3.5-4B Q4_K_M (~2.7GB)
- Image: FLUX.2 [klein] 4B GGUF Q4_K_M (~2.6GB)
* Mô hình không được cài ở máy này. tôi sẽ cung cấp API để kết nối sau.

# Mục Tiêu Project:
- Tạo ra một nền tảng chatbot AI tự host, xử lý được tác vụ chat và tạo sinh hình ảnh.

# Giai đoạn triển khai
## Giai đoạn 1: Frontend
- Triển khai giao diện dựa trên teckstack đã chốt
## Giai đoạn 2: Backend
- Triển khai backend
- Kết nối với mô hình
- Test thử tính năng
## Giai đoạn 3: Fix & Hoàn thiện
- Sửa các lỗi phát sinh 
- Tối ưu hiệu năng
- Hoàn thiện Project