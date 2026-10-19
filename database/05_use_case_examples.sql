-- VÍ DỤ ĐỌC DỮ LIỆU: thay ID bằng tài khoản từ phiên đăng nhập.
-- Tài khoản demo khach03 có id=6; khach05 có id=8.

-- 1. Tra cứu tài khoản để BACKEND xác minh mật khẩu băm và trạng thái.
-- Không gửi mat_khau_hash về frontend; dùng truy vấn có tham số khi lập trình.
SELECT id,ten_dang_nhap,mat_khau_hash,vai_tro,trang_thai
FROM tai_khoan WHERE ten_dang_nhap = lower(btrim('khach03'));

-- 2. Khách id=8 xem khảo sát đang mở, được nhận và chưa làm.
SELECT k.id,k.tieu_de,k.mo_ta,k.ngay_ket_thuc,p.ngay_gui
FROM phan_phoi_khao_sat p JOIN khao_sat k ON k.id = p.khao_sat_id
JOIN tai_khoan t ON t.id = p.khach_hang_id
WHERE p.khach_hang_id = 8 AND t.trang_thai = 'active'
  AND p.ngay_hoan_thanh IS NULL AND k.trang_thai = 'dang_mo'
  AND (k.ngay_ket_thuc IS NULL OR k.ngay_ket_thuc > current_timestamp)
ORDER BY p.ngay_gui DESC;

-- 3. Đọc câu hỏi và đáp án: luôn kiểm tra khách thuộc danh sách được nhận.
SELECT c.id AS cau_hoi_id,c.noi_dung,c.bat_buoc,l.id AS lua_chon_id,l.noi_dung AS dap_an
FROM cau_hoi c JOIN lua_chon l ON l.cau_hoi_id = c.id
WHERE c.khao_sat_id = 1
  AND EXISTS(SELECT 1 FROM phan_phoi_khao_sat p JOIN tai_khoan t ON t.id = p.khach_hang_id
    WHERE p.khao_sat_id = c.khao_sat_id AND p.khach_hang_id = 8 AND t.trang_thai = 'active')
ORDER BY c.thu_tu,l.thu_tu;

-- 4. Danh sách phản hồi mới nhất cho nhân viên/quản lý.
SELECT p.id,h.ho_ten,d.ten_do_uong,p.so_sao,p.noi_dung,p.trang_thai,p.ngay_gui
FROM phan_hoi p JOIN khach_hang h ON h.tai_khoan_id = p.khach_hang_id
JOIN do_uong d ON d.id = p.do_uong_id
ORDER BY p.ngay_gui DESC,p.id DESC;

-- 5. Tìm kiếm nâng cao khách: tên, trạng thái, tuổi, nhóm sở thích.
SELECT * FROM v_danh_sach_khach_hang
WHERE trang_thai = 'active' AND tuoi_uoc_tinh BETWEEN 18 AND 35
  AND ho_ten ILIKE '%An%'
ORDER BY ngay_tao DESC,tai_khoan_id DESC;

/* VÍ DỤ GHI: nằm trong comment để tránh vô tình thay đổi dữ liệu demo.
-- A. Đăng ký hoặc nhân viên thêm khách. Backend tạo hash trước khi gọi SQL.
BEGIN;
WITH tk AS (
  INSERT INTO tai_khoan(ten_dang_nhap,mat_khau_hash,vai_tro,nguoi_tao_id)
  VALUES ('khach_moi', :mat_khau_hash, 'customer', NULL) RETURNING id
)
INSERT INTO khach_hang(tai_khoan_id,ma_thanh_vien,ho_ten,nam_sinh,gioi_tinh,so_thich_id)
SELECT id,'TV-' || id,'Khách mới',2005,'khong_cung_cap',1 FROM tk;
COMMIT;
-- :mat_khau_hash là biến của backend, không phải mật khẩu gốc.
-- Tạo tại quầy: điền nguoi_tao_id = ID nhân viên, cấp tên đăng nhập cho khách.

-- B. Chỉnh sửa hồ sơ (ID=8 phải lấy từ phiên, không lấy tùy ý từ request).
UPDATE khach_hang SET ho_ten='Lê Gia Hân',nam_sinh=2000,so_thich_id=4
WHERE tai_khoan_id=8;

-- C. Gửi phản hồi; backend chỉ cho tài khoản đã xác thực thao tác.
INSERT INTO phan_hoi(khach_hang_id,do_uong_id,so_sao,noi_dung)
VALUES (8,1,5,'Trân châu mềm, mức ngọt vừa phải.');

-- D. Tiếp nhận phản hồi.
SELECT crm_xu_ly_phan_hoi(2,1,'da_tiep_thu');

-- E. Khóa / mở khóa tài khoản khách hàng.
SELECT crm_dat_trang_thai_khach_hang(2,8,'locked');
SELECT crm_dat_trang_thai_khach_hang(2,8,'active');

-- F. Phát hành khảo sát 3 đến nhóm cụ thể.
SELECT crm_phat_hanh_khao_sat(2,3,ARRAY[4,5,8]::bigint[]);
-- Hoặc toàn bộ khách active: SELECT crm_phat_hanh_khao_sat(2,3);
-- Hoặc chọn theo sở thích: truyền mảng ID thu được từ truy vấn lọc khach_hang.

-- G. Nộp khảo sát 1, khách 8. Câu 1 chọn phương án 2; câu 2 chọn phương án 4.
SELECT crm_nop_khao_sat(8,1,
  '[{"cau_hoi_id":1,"lua_chon_id":2},{"cau_hoi_id":2,"lua_chon_id":4}]'::jsonb);

-- H. Đóng khảo sát.
SELECT crm_dong_khao_sat(2,1);
*/
