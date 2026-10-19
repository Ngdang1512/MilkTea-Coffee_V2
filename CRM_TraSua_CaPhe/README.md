# milktea-coffee — CRM quản lý và chăm sóc khách hàng

Bộ phân tích và thiết kế cho hệ thống **milktea-coffee**. Mộc Trà là tên doanh nghiệp giả định trong dữ liệu demo.

## Bộ bàn giao

- `Bao_cao_Phan_tich_Thiet_ke_CRM.docx`: báo cáo chỉnh sửa được, gồm yêu cầu, phân quyền, quy tắc, DFD, ERD, use case, tuần tự, class, activity, trạng thái, kiến trúc, từ điển dữ liệu, API, kiểm thử và kế hoạch 15 tuần.
- `Bo_so_do_CRM.pdf`: 25 sơ đồ và 4 trang diễn giải luồng DFD; thuận tiện mở riêng để thuyết trình.
- `diagrams/`: 25 sơ đồ ở dạng PNG, SVG và nguồn `.puml` hoặc `.dot`; `manifest.json` có tiêu đề và giải thích.
- `../database/CRM_TraSua_CaPhe.dbml`: toàn bộ 11 bảng, enum, khóa và mối quan hệ; dán vào dbdiagram.io để xem ERD.
- `../database/`: SQL tạo CSDL, trigger, hàm nghiệp vụ, dữ liệu demo, 6 view, ví dụ sử dụng và kiểm tra.

## Cài đặt CSDL

1. Chuẩn bị PostgreSQL và pgAdmin hoặc psql. Bộ SQL đã được chạy trên PostgreSQL 18.3 qua PGlite 0.5.8.
2. Chạy `00_create_database.sql` từ kết nối quản trị ngoài transaction để tạo database mới. Hoặc dùng giao diện tạo database tên `crm_tra_sua_ca_phe`, UTF8.
3. Kết nối vào database mới. Chạy `CRM_Create_All.sql` **một lần**.
4. Không chạy lại các file `01` đến `04` nếu đã dùng bản gộp. Nếu muốn chạy riêng, thứ tự là `01_schema.sql`, `02_business_rules.sql`, `03_demo_data.sql`, `04_reports.sql`.
5. Đọc `05_use_case_examples.sql`. Các ví dụ thay đổi dữ liệu được để trong comment để không làm biến đổi demo khi chạy toàn file.
6. Chạy `06_verify.sql` trên dữ liệu demo nguyên trạng. Script kiểm tra rồi ROLLBACK thay đổi. File `verification_result.json` ghi 46 kiểm tra đã đạt.

Ví dụ psql, chạy từ thư mục database:

```sh
psql -U postgres -d crm_tra_sua_ca_phe -v ON_ERROR_STOP=1 -f CRM_Create_All.sql
psql -U postgres -d crm_tra_sua_ca_phe -v ON_ERROR_STOP=1 -f 06_verify.sql
```

Đây là script cho PostgreSQL, không chạy nguyên dạng trên MySQL hay SQL Server. Thời gian dùng timestamptz; cấu hình kết nối ở Asia/Ho_Chi_Minh khi hiển thị và lập báo cáo.

## Tài khoản demo

| Username | Vai trò | Trạng thái |
|---|---|---|
| admin | admin | active |
| quanly | manager | active |
| nhanvien | staff | active |
| khach01 đến khach07 | customer | active |
| khach08 | customer | locked |

Mật khẩu tất cả tài khoản demo: `DemoCRM@2026`. Mỗi hash có salt riêng. Định dạng: `scrypt$N$r$p$salt_base64$derived_key_base64`, với N=131072, r=8, p=1 và derived key 32 byte. Hash do backend xác minh; DB không so sánh trực tiếp mật khẩu gốc.

Tham khảo: `python verify_demo_password.py khach01` rồi nhập mật khẩu. Đây chỉ là kiểm tra hash trong dữ liệu demo; đăng nhập thực tế còn kiểm tra trạng thái và phiên.

## Các quyết định nghiệp vụ

- Customer có đúng một hồ sơ và một sở thích mặc định; tài khoản dùng chung toàn chuỗi.
- Khóa giữ lịch sử và phải chặn cả phiên đang mở ở backend. Xóa cứng xóa luôn phản hồi, phân phối, bài làm của khách đó; thống kê hiện tại sẽ thay đổi.
- Khảo sát gồm câu chọn một. Gửi khảo sát là tạo bản ghi trong tài khoản; không gửi email/SMS.
- Chỉ gửi mới cho khách active; tập người nhận được chốt tại lần phát hành. Khách bị khóa sau khi nhận vẫn nằm trong mẫu số.
- Không lưu bài nháp; đáp án và thời điểm hoàn thành cùng một transaction; mỗi khách nộp một lần.
- Tuổi là năm hiện tại trừ năm sinh, không phải tuổi chính xác theo ngày sinh; không suy luận nghề nghiệp từ tuổi.
- Khi không có mẫu số, tỷ lệ là NULL để UI hiển thị “Chưa có dữ liệu”.
- Có 3 FK ghép trong câu trả lời. khao_sat_id lặp có chủ đích để DB kiểm tra đúng quan hệ; không tuyên bố mô hình vật lý đạt 3NF tuyệt đối.

## Triển khai ứng dụng tiếp theo

Các file này hoàn thành phần phân tích thiết kế và CSDL. **Chưa có ứng dụng Web/API đã triển khai**. Các lớp service, hợp đồng API và màn hình trong báo cáo là thiết kế cho nhóm lập trình.

### Prototype giao diện

Prototype responsive cho Manager và Customer nằm bên ngoài thư mục CRM tại `../frontend`, gồm dashboard, khách hàng, phản hồi, khảo sát và các điểm vào báo cáo/quản trị. Từ thư mục gốc repository, chạy:

```sh
cd frontend
npm run dev
```

Sau đó mở `http://localhost:4173`. Cấu trúc triển khai đầy đủ và ranh giới phân quyền được ghi tại `docs/PROJECT_STRUCTURE.md`.

Backend phải lấy actor ID và customer ID từ phiên; không tin ID người thao tác gửi tùy ý từ client. Các hàm SQL không thay thế xác thực HTTP. Bổ sung kiểm tra danh mục active, Admin active cuối cùng, thu hồi phiên locked, truy vấn có tham số, giới hạn đăng nhập và kiểm thử đồng thời trên PostgreSQL thật. Không cấp quyền truy cập SQL trực tiếp cho khách hàng.

Yêu cầu phiếu khảo sát hiện trạng HTTT tối thiểu 15 câu là khác với khảo sát sản phẩm trong app. Báo cáo đã có mẫu 15 câu; nhóm cần thu thập dữ liệu thực tế, điền kết quả và thông tin thành viên trước khi nộp. Không dùng kết quả demo như khảo sát doanh nghiệp thật.

## Chỉnh sửa sơ đồ

Nguồn `.puml` dùng PlantUML 1.2026.6 với Smetana; nguồn `.dot` dùng Graphviz. Bản PNG để chèn Word, SVG để phóng to. Mở `.puml` bằng trình hỗ trợ PlantUML hoặc dùng Java với file plantuml.jar đã tải từ nguồn chính thức:

```sh
java -jar plantuml.jar -charset UTF-8 -tsvg diagrams/14_seq_submit.puml
dot -Tsvg diagrams/02_dfd_level0_accounts.dot -o diagrams/02_dfd_level0_accounts.svg
```

Trong DFD, mã F được giải thích đầy đủ trong báo cáo, PDF và manifest. Hai sơ đồ mức 0 là hai phần của cùng mức; không coi phần thứ hai là mức phân rã mới.

## Danh mục sơ đồ

| Tệp nguồn | Nội dung |
|---|---|
| `01_dfd_context.dot` | DFD ngữ cảnh |
| `02_dfd_level0_accounts.dot` | DFD mức 0 phần tài khoản và khách hàng |
| `03_dfd_level0_crm.dot` | DFD mức 0 phần chăm sóc và báo cáo |
| `04_dfd_level1_survey.dot` | DFD mức 1 của tiến trình khảo sát |
| `05_usecase_customer.puml` | Use case khách hàng |
| `06_usecase_customer_management.puml` | Use case quản lý khách hàng và phản hồi |
| `07_usecase_survey_admin.puml` | Use case khảo sát và quản trị |
| `08_seq_register.puml` | Tuần tự đăng ký và thêm khách tại quầy |
| `09_seq_login.puml` | Tuần tự đăng nhập |
| `10_seq_profile.puml` | Tuần tự cập nhật hồ sơ |
| `11_seq_lock_delete.puml` | Tuần tự khóa và xóa khách hàng |
| `12_seq_feedback.puml` | Tuần tự gửi và tiếp nhận phản hồi |
| `13_seq_publish.puml` | Tuần tự soạn và phát hành khảo sát |
| `14_seq_submit.puml` | Tuần tự nhận và nộp khảo sát |
| `15_seq_reports.puml` | Tuần tự xem các báo cáo |
| `16_erd_accounts.puml` | ERD tài khoản và hồ sơ |
| `17_erd_feedback.puml` | ERD đồ uống và phản hồi |
| `18_erd_survey.puml` | ERD khảo sát và bài làm |
| `19_er_concept.dot` | Mô hình thực thể kết hợp khái niệm |
| `20_class_customer.puml` | Class miền khách hàng và chăm sóc |
| `21_class_survey.puml` | Class miền khảo sát |
| `22_class_services.puml` | Class dịch vụ ứng dụng |
| `23_activity_submit.puml` | Activity thực hiện khảo sát |
| `24_state_survey.puml` | State machine vòng đời khảo sát |
| `25_architecture.puml` | Kiến trúc triển khai đề xuất |
