# milktea-coffee

CRM quản lý và chăm sóc khách hàng cho chuỗi trà sữa/cà phê. Giao diện và API chạy bằng Node.js; dữ liệu lưu trong PostgreSQL. Apache/MySQL của XAMPP không cần dùng để chạy ứng dụng.

## 1. Chuẩn bị PostgreSQL và database

Đảm bảo PostgreSQL đang chạy, sau đó trong pgAdmin:

1. Tạo database `crm_tra_sua_ca_phe`.
2. Chọn database vừa tạo, mở **Query Tool** và chạy `database/CRM_Create_All.sql`. Chỉ chạy script này trên database trống.
3. Tiếp tục chạy `database/07_notifications_and_replies.sql`.
4. Chạy `database/10_admin_governance.sql` để bật quản lý Manager và yêu cầu duyệt khóa khách hàng.
5. Chạy `database/11_remove_customer_deletion_audit.sql` để vô hiệu hóa các yêu cầu xóa cũ; nhật ký Audit Log trước đây (nếu có) được giữ lại trong database nhưng không còn chức năng xem/rollback.

Có thể mở từng file SQL trong VS Code, copy toàn bộ nội dung, dán vào Query Tool của đúng database rồi nhấn **Execute**. Chạy các migration 07 và 10 theo đúng thứ tự trên.

Tài khoản demo được nạp từ dữ liệu mẫu:

- Admin: `admin` / `DemoCRM@2026`
- Manager: `quanly` / `DemoCRM@2026`
- Customer: `khach01` / `DemoCRM@2026`

Nếu database đã tồn tại, không chạy lại `CRM_Create_All.sql`; xem [database/README.md](database/README.md) để biết các migration cần áp dụng.

## 2. Cấu hình và khởi động API

Mở một cửa sổ PowerShell:

```powershell
cd C:\xampp\htdocs\MilkTea-Coffee\api
npm install
if (!(Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
```

Trong `api/.env`, đặt:

- `DB_PASSWORD`: mật khẩu PostgreSQL của bạn.
- `AUTH_SECRET`: chuỗi bí mật ngẫu nhiên riêng, dài ít nhất 32 ký tự.
- `FRONTEND_ORIGINS`: phải có địa chỉ frontend đang dùng. Mặc định đã cho phép các cổng `4173`, `4174` và `4175`.

Lưu file rồi khởi động API:

```powershell
npm run dev
```

Giữ cửa sổ này mở. Mở http://127.0.0.1:3000/health để xác nhận API và PostgreSQL đã kết nối; kết quả cần có `"status":"ok"` và `"database":"connected"`.

## 3. Khởi động giao diện web

Mở cửa sổ PowerShell thứ hai:

```powershell
cd C:\xampp\htdocs\MilkTea-Coffee\frontend
npm install
npm run dev
```

Lệnh này mở đồng thời ba cổng; giữ cửa sổ này mở, sau đó truy cập:

Admin đang chạy tại http://127.0.0.1:4173
Manager đang chạy tại http://127.0.0.1:4174
Customer đang chạy tại http://127.0.0.1:4175

Đăng nhập bằng tài khoản demo ở trên. Admin mới cần migration 10; nếu chưa chạy migration, các trang quản trị mới sẽ báo thiếu cấu trúc database. Để chạy ứng dụng, cần giữ cả hai cửa sổ PowerShell (API và frontend) mở. XAMPP/Apache và MySQL không cần bật; pgAdmin chỉ dùng để quản lý PostgreSQL.

## Khắc phục lỗi

- API không khởi động: xem lỗi trong PowerShell; kiểm tra PostgreSQL đang chạy, `DB_PASSWORD`, database và extension/package PostgreSQL (API Node.js dùng package `pg`, không dùng PHP của XAMPP).
- `/health` báo lỗi: API chưa kết nối được PostgreSQL; kiểm tra PostgreSQL đang chạy, host/cổng trong `DB_DSN` (mặc định `localhost:5432`), `DB_PASSWORD` và database `crm_tra_sua_ca_phe`.
- Trình duyệt báo `Failed to fetch`: kiểm tra API và frontend đang chạy; xác nhận `FRONTEND_ORIGINS` trong `api/.env` có origin tương ứng (`http://127.0.0.1:4173`, `http://127.0.0.1:4174` hoặc `http://127.0.0.1:4175`).
- Báo thiếu bảng/cột hoặc cấu trúc database: kiểm tra đã chạy `07_notifications_and_replies.sql` rồi `10_admin_governance.sql` trên đúng database chưa. Hướng dẫn chi tiết: [database/README.md](database/README.md).

Chi tiết API: [api/README.md](api/README.md).

Nếu tạo database mới, chạy theo thứ tự:
CRM_Create_All.sql
07_notifications_and_replies.sql
10_admin_governance.sql
11_remove_customer_deletion_audit.sql

Nếu pgAdmin báo lỗi, chạy ROLLBACK; để thoát transaction lỗi, rồi xử lý lỗi đầu tiên trong tab Messages trước khi chạy lại.