# milktea-coffee API

REST API dùng Node.js và PostgreSQL. PHP/Apache trong XAMPP không chạy API này; pgAdmin chỉ dùng để quản lý PostgreSQL.

## Cài đặt và khởi động trên Windows

```powershell
cd C:\xampp\htdocs\MilkTea-Coffee\api
npm install
if (!(Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
npm run dev
```

Trong `.env`, nhập mật khẩu PostgreSQL vào `DB_PASSWORD`, đặt `AUTH_SECRET` thành chuỗi riêng ngẫu nhiên dài ít nhất 32 ký tự, và giữ `FRONTEND_ORIGINS` phù hợp với địa chỉ giao diện trong README gốc. Không đưa `.env` lên Git.

Kiểm tra `http://127.0.0.1:3000/health`. API chỉ báo `status: ok` khi truy vấn kiểm tra PostgreSQL cũng thành công.

## Database

Tạo database `crm_tra_sua_ca_phe`, nạp schema và dữ liệu mẫu từ `database/CRM_Create_All.sql` trên database trống, rồi chạy migration `database/07_notifications_and_replies.sql` và `database/10_admin_governance.sql`. Với database đã sử dụng, không chạy script khởi tạo; xem `database/README.md` và chỉ áp dụng migration tương ứng.

## API được frontend sử dụng

Các phiên đăng nhập dùng Bearer token có hạn 8 giờ; ID tài khoản luôn lấy từ token đã ký, không tin ID gửi từ trình duyệt.

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/health` | Kiểm tra API và PostgreSQL |
| `POST` | `/auth/register`, `/auth/login` | Đăng ký và đăng nhập khách hàng |
| `GET` | `/catalogs/options` | Danh mục dùng khi đăng ký/phản hồi |
| `GET/PATCH` | `/me` | Đọc/cập nhật hồ sơ khách hàng |
| `GET/POST` | `/me/feedback` | Lịch sử và gửi phản hồi |
| `GET` | `/me/surveys`, `/me/surveys/{id}` | Khảo sát đã phân phối |
| `POST` | `/me/surveys/{id}/submit` | Nộp câu trả lời qua hàm nghiệp vụ PostgreSQL |
| `GET` | `/me/notifications` | Đọc thông báo |
| `PATCH` | `/me/notifications/{id}` | Đánh dấu thông báo đã đọc |
| `POST` | `/internal/auth/login` | Đăng nhập Admin/Manager |
| `GET` | `/internal/me`, `/internal/dashboard` | Phiên và tổng quan |
| `GET` | `/internal/customers` | Danh sách khách hàng (Admin/Manager) |
| `POST/PATCH` | `/internal/customers[/{id}]` | Manager tạo/sửa khách hàng |
| `PATCH` | `/internal/customers/{id}/status` | Admin khóa/mở khóa khách hàng |
| `GET/POST/PATCH` | `/internal/managers[/{id}]` | Admin quản lý nhân sự Manager |
| `GET/POST/PATCH` | `/internal/customer-requests[/{id}]` | Manager gửi/xem yêu cầu khóa; Admin duyệt hoặc từ chối |
| `GET` | `/internal/reports/customers` | Báo cáo khách hàng |
| `GET/PATCH` | `/internal/feedback[/{id}]` | Danh sách/xử lý phản hồi |
| `GET/POST` | `/internal/surveys` | Danh sách/phát hành khảo sát |
| `GET/PATCH` | `/internal/surveys/{id}` | Đọc/cập nhật khảo sát |
| `PATCH` | `/internal/surveys/{id}/visibility` | Ẩn/khôi phục khảo sát |
| `GET` | `/internal/surveys/{id}/results` | Thống kê kết quả |
| `GET` | `/internal/accounts`, `/internal/catalogs` | Tài khoản nội bộ/danh mục |

API chỉ cho phép CORS từ các origin được liệt kê trong `FRONTEND_ORIGINS`. Mỗi endpoint quản trị kiểm tra vai trò phía máy chủ; thao tác duyệt yêu cầu và cập nhật trạng thái khách hàng dùng các hàm nghiệp vụ đã định nghĩa trong PostgreSQL. Không còn endpoint xóa khách hàng hoặc Audit Log/Rollback.
