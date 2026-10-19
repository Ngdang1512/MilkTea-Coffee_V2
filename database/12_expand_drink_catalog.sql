-- Bổ sung đồ uống mẫu để khách hàng có nhiều lựa chọn đánh giá hơn.
-- Có thể chạy lại an toàn.
BEGIN;

INSERT INTO do_uong(ma_do_uong, ten_do_uong, mo_ta, dang_kinh_doanh) VALUES
  ('TS03', 'Trà sữa Matcha', 'Matcha, sữa tươi và trân châu trắng', true),
  ('TS04', 'Trà sữa đường đen', 'Sữa tươi, đường đen và trân châu', true),
  ('TT02', 'Trà vải hoa hồng', 'Trà thanh nhẹ kết hợp vải và hương hoa hồng', true),
  ('TT03', 'Trà chanh dây mật ong', 'Chanh dây, trà và mật ong', true),
  ('CP02', 'Bạc xỉu', 'Cà phê sữa nhẹ, phù hợp khẩu vị ít đắng', true)
ON CONFLICT (ma_do_uong) DO UPDATE
SET ten_do_uong = EXCLUDED.ten_do_uong,
    mo_ta = EXCLUDED.mo_ta,
    dang_kinh_doanh = true;

COMMIT;
