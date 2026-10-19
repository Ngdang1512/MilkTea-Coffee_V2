# Cấu trúc triển khai đề xuất

```text
milktea-coffee/
├── frontend/                   # SPA cho Manager và Customer
│   ├── admin/                  # Route và guard quản trị
│   ├── configs/                # Cấu hình frontend và API URL
│   ├── extends/                # Lớp nền để mở rộng
│   ├── libraries/              # Logic UI và tiện ích dùng chung
│   ├── models/                 # Model dữ liệu phía frontend
│   ├── views/
│   │   ├── admin/              # Entry page Manager/Admin
│   │   └── front/              # Entry page Customer
│   ├── templates/
│   │   ├── admin/              # Style và tài nguyên quản trị
│   │   └── front/              # Style và tài nguyên khách hàng
│   └── userfiles/              # Tài nguyên tải lên trong tương lai
├── api/                        # REST API dùng chung
│   └── src/
│       ├── modules/            # auth, customers, feedback, surveys, reports, admin
│       ├── middleware/         # session, RBAC, validation, rate limit
│       └── repositories/       # Truy vấn PostgreSQL có tham số
├── database/                   # Schema, rules, demo data, views và verification
├── CRM_TraSua_CaPhe/
│   ├── diagrams/               # Nguồn và bản xuất 25 sơ đồ
│   └── docs/                   # Quyết định kiến trúc và tài liệu lập trình
└── tests/
    ├── api/                    # Phân quyền, validation, transaction
    └── e2e/                    # Luồng người dùng theo vai trò
```

## Ranh giới chức năng

- `customer`: đăng ký/đăng nhập, hồ sơ, gửi phản hồi, nhận và nộp khảo sát.
- `staff`: tìm/thêm khách tại quầy và tiếp nhận phản hồi.
- `manager`: kế thừa staff; khóa/xóa khách, soạn/phát hành/đóng khảo sát, xem báo cáo.
- `admin`: khu vực riêng; kế thừa manager và quản lý tài khoản nội bộ, sở thích, đồ uống.

Mọi ID người thao tác và khách hàng phải lấy từ phiên ở backend. Ẩn nút trên UI chỉ hỗ trợ trải nghiệm, không thay thế kiểm tra quyền trên từng endpoint.

## Hướng UI

Giao diện sử dụng sắc xanh trà, nền kem và điểm nhấn màu hổ phách; ưu tiên dữ liệu, trạng thái và thao tác rõ ràng. Navigation trái cho nghiệp vụ thường xuyên, topbar cho tìm kiếm toàn cục, các bảng cuộn ngang trên màn hình nhỏ và dashboard tự chuyển từ 4 xuống 2/1 cột.
